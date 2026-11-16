"""Import a reproducible, local animated Pokémon pack. Requires Python + Pillow.

Run: python scripts/import-pokemon.py [--count 493] [--no-shiny]
No Python dependency is required to run the resulting Windows application.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "scripts/pokemon-source.json"
CACHE = ROOT / ".cache/pokemon"
OUTPUT = ROOT / "public/sprites/pokemon"


def download(url):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "PokeParade-local-asset-importer"})
            with urllib.request.urlopen(request, timeout=45) as response:
                data = response.read(8_000_001)
            if len(data) > 8_000_000:
                raise ValueError(f"Asset too large: {url}")
            return data
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise
            if attempt == 3:
                raise
        except (OSError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(1 + attempt)


def prepare_asset(species, sprite_commit, shiny=False):
    dex = int(species["id"])
    variant = "shiny/" if shiny else ""
    cache_variant = "shiny-" if shiny else ""
    path = f"sprites/pokemon/versions/generation-v/black-white/animated/{variant}{dex}.gif"
    source = f"https://raw.githubusercontent.com/PokeAPI/sprites/{sprite_commit}/{path}"
    cached = CACHE / f"{sprite_commit}-{cache_variant}{dex}.gif"
    try:
        raw = cached.read_bytes() if cached.exists() else download(source)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        path = f"sprites/pokemon/{variant}{dex}.png"
        source = f"https://raw.githubusercontent.com/PokeAPI/sprites/{sprite_commit}/{path}"
        cached = CACHE / f"{sprite_commit}-{cache_variant}{dex}.png"
        try:
            raw = cached.read_bytes() if cached.exists() else download(source)
        except urllib.error.HTTPError as fallback_error:
            if shiny and fallback_error.code == 404:
                return None
            raise
    cached.write_bytes(raw)

    frames, durations = [], []
    with Image.open(io.BytesIO(raw)) as image:
        for index in range(getattr(image, "n_frames", 1)):
            image.seek(index)  # Pillow handles GIF disposal and composite frames.
            frame = image.convert("RGBA").copy()
            duration = max(20, int(image.info.get("duration", 100) or 100))
            if frames and frame.tobytes() == frames[-1].tobytes():
                durations[-1] += duration
            else:
                frames.append(frame)
                durations.append(duration)
    boxes = [frame.getchannel("A").getbbox() for frame in frames]
    boxes = [box for box in boxes if box]
    if not boxes:
        raise ValueError(f"Empty sprite: {dex}")
    bounds = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    # One common crop for all frames keeps the animation anchored and prevents jitter.
    frames = [frame.crop(bounds) for frame in frames]
    width, height = frames[0].size
    columns = min(10, math.ceil(math.sqrt(len(frames))))
    rows = math.ceil(len(frames) / columns)
    atlas = Image.new("RGBA", (columns * width, rows * height))
    for index, frame in enumerate(frames):
        atlas.paste(frame, ((index % columns) * width, (index // columns) * height))
    atlas.save(OUTPUT / f"{variant}{dex}.png", optimize=True)
    frames[0].save(OUTPUT / "thumbs" / f"{variant}{dex}.png", optimize=True)
    skin = {
        "id": species["identifier"] + ("-shiny" if shiny else ""), "name": species["displayName"] + (" ✦" if shiny else ""), "dexNumber": dex,
        "generation": int(species["generation_id"]), "shiny": shiny,
        "image": f"/sprites/pokemon/{variant}{dex}.png", "preview": f"/sprites/pokemon/thumbs/{variant}{dex}.png",
        "frameWidth": width, "frameHeight": height, "columns": columns, "rows": rows,
        "fps": 10, "frameDurations": durations, "facing": "left",
        "animations": {"idle": list(range(len(frames)))}
    }
    provenance = {"dexNumber": dex, "id": skin["id"], "shiny": shiny, "url": source, "sourceSha256": hashlib.sha256(raw).hexdigest(), "frames": len(frames), "durationMs": sum(durations)}
    return skin, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=493)
    parser.add_argument("--no-shiny", action="store_true", help="Import only regular variants")
    args = parser.parse_args()
    if not 1 <= args.count <= 1025:
        parser.error("count must be 1–1025")
    CACHE.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "thumbs").mkdir(parents=True, exist_ok=True)
    (OUTPUT / "shiny").mkdir(parents=True, exist_ok=True)
    (OUTPUT / "thumbs/shiny").mkdir(parents=True, exist_ok=True)
    if LOCK.exists():
        revisions = json.loads(LOCK.read_text())
    else:
        revisions = {key: json.loads(download(f"https://api.github.com/repos/PokeAPI/{repo}/commits/master"))["sha"] for key, repo in [("spritesCommit", "sprites"), ("dataCommit", "pokeapi")]}
        LOCK.write_text(json.dumps(revisions, indent=2) + "\n")
    data_base = f"https://raw.githubusercontent.com/PokeAPI/pokeapi/{revisions['dataCommit']}/data/v2/csv"
    species = list(csv.DictReader(io.StringIO(download(f"{data_base}/pokemon_species.csv").decode())))
    names_raw = download(f"{data_base}/pokemon_species_names.csv")
    names = {int(row["pokemon_species_id"]): row["name"] for row in csv.DictReader(io.StringIO(names_raw.decode())) if row["local_language_id"] == "9"}
    selected = sorted([row for row in species if int(row["id"]) <= args.count], key=lambda row: int(row["id"]))
    if len(selected) != args.count:
        raise ValueError("Species list is incomplete")
    for row in selected:
        row["displayName"] = names[int(row["id"])]
    skins, provenance = [], []
    jobs = [(row, shiny) for shiny in ([False] if args.no_shiny else [False, True]) for row in selected]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for result in pool.map(lambda job: prepare_asset(job[0], revisions["spritesCommit"], job[1]), jobs):
            if result is None:
                continue
            skin, source = result
            skins.append(skin)
            provenance.append(source)
            if len(skins) % 50 == 0 or len(skins) == len(jobs):
                print(f"Imported {len(skins)}/{len(jobs)} Pokémon variants", flush=True)
    license_url = f"https://raw.githubusercontent.com/PokeAPI/sprites/{revisions['spritesCommit']}/LICENCE.txt"
    (OUTPUT / "LICENSE-PokeAPI.txt").write_bytes(download(license_url))
    (OUTPUT / "SOURCE.json").write_text(json.dumps({"repository": "https://github.com/PokeAPI/sprites", **revisions, "assets": provenance}, indent=2) + "\n")
    manifest = ROOT / "public/sprites/manifest.json"
    # Do not activate a partial catalog if any download or conversion failed.
    temporary = manifest.with_suffix(".json.tmp")
    temporary.write_text(json.dumps({"skins": skins}, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(manifest)
    print(f"Ready: {len(skins)} local Pokémon. Run npm run build.")


if __name__ == "__main__":
    main()
