# Pokémon sprite pack

Source repository: https://github.com/PokeAPI/sprites

This application includes Pokémon #001–#151 from the repository's
`sprites/pokemon/versions/generation-v/black-white/animated/` directory.
Original GIFs are converted to transparent PNG atlases without redrawing or resizing
the artwork. Frame order, GIF compositing, and frame durations are preserved.
Transparent margins are cropped consistently across all frames of each character.

These are battle animation sprites, not overworld walking animations. The application
adds movement along the scene, a jump transform, and a dance transform.

The upstream license states that image contents are Copyright The Pokémon Company
and that the repository is distributed under CC0 1.0 Universal. The original license
is included at `dist/public/sprites/pokemon/LICENSE-PokeAPI.txt` in the Windows release
(source project: `public/sprites/pokemon/LICENSE-PokeAPI.txt`).

Exact repository revisions, source URLs and SHA-256 hashes are recorded in
`public/sprites/pokemon/SOURCE.json` (under `dist/` in the release). Species identifiers
and English names come from the PokeAPI/pokeapi CSV data at the recorded revision.

Importer: `scripts/import-pokemon.py`, using Python and Pillow during asset preparation
only. The Windows application requires neither Python nor Pillow and makes no external
sprite requests at runtime.
