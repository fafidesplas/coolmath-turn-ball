# Pixel edition art pipeline

The pixel edition (`/pixel/`) uses art from **Basketball Asset Pack - Hoops in Pixel** by Josee
(https://n3cloud.itch.io/basketball-hoops-in-pixel), bought on itch.io.

## License (from the itch.io page; the pack's license.txt is empty)

- Allowed: edit, alter and use the assets in a commercial or non-commercial video game.
- Not allowed: resell, redistribute, sublicense or share the raw assets, sprite sheets or source
  files, even modified.
- Not allowed: use them, in whole or in part, to train AI/ML models, datasets or algorithms.

## How this repo respects it

- The pack itself (zip, `.aseprite`, Character_Customizer.exe, sheets) is never copied here.
- `export_atlas.py` (code only) builds one optimized atlas with just the crops and frames the game
  uses: `src/pixel/art/atlas.png` + `atlas.json`. That folder is git-ignored.
- The repo only holds `art.sealed`, the atlas encrypted with AES-256-GCM. The key lives in the
  git-ignored `.pixel-art-key` file and in the `PIXEL_ART_KEY` repository secret, so only the deployed
  build (GitHub Pages) contains the usable atlas, as part of the game.

## Commands

```bash
# Rebuild the atlas from the pack (needs Python 3 with Pillow)
HOOPS_PACK=/path/to/Hoops_in_pixels_V2 npm run art:export
npm run art:seal      # re-encrypt into tools/pixel-art/art.sealed (commit that file)
npm run art:unseal    # restore src/pixel/art/ from art.sealed (needs the key)
```

Without the key, `npm run build` fails on the missing atlas. The 3D game at the root does not use
these files.
