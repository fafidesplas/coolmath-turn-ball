"""Build the pixel-art atlas for Turn Ball Pixel from the licensed asset pack.

Usage: python3 tools/pixel-art/export_atlas.py <path to Hoops_in_pixels_V2> <out dir>

Needs Pillow. Reads the pack (court.png, ball, decor, characters/character.aseprite) and writes
atlas.png + atlas.json with only the crops and animation frames the game uses. The pack itself and
this output are licensed assets: never commit them (see tools/pixel-art/README.md).
"""
import json, os, struct, sys, zlib
from PIL import Image

PACK, OUT = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------- aseprite reader
def read_ase(path):
    d = open(path, 'rb').read()
    _, magic, nframes, w, h, depth = struct.unpack_from('<IHHHHH', d, 0)
    if magic != 0xA5E0 or depth != 32:
        raise SystemExit('unexpected aseprite file')
    off = 128; layers = []; frames = []; tags = {}
    for _ in range(nframes):
        fsize, _m, old, dur = struct.unpack_from('<IHHH', d, off)
        n = struct.unpack_from('<I', d, off + 12)[0] or old
        co = off + 16; cels = {}
        for _ in range(n):
            csize, ctype = struct.unpack_from('<IH', d, co); b = co + 6
            if ctype == 0x2004:
                nl = struct.unpack_from('<H', d, b + 16)[0]
                layers.append(d[b + 18:b + 18 + nl].decode())
            elif ctype == 0x2005:
                li, x, y, op, ct = struct.unpack_from('<HhhBH', d, b)
                q = b + 16
                if ct == 1:
                    cels[li] = ('link', struct.unpack_from('<H', d, q)[0])
                elif ct in (0, 2):
                    cw, ch = struct.unpack_from('<HH', d, q)
                    raw = d[q + 4:co + csize]
                    cels[li] = (x, y, cw, ch, zlib.decompress(raw) if ct == 2 else raw)
            elif ctype == 0x2018:
                nt = struct.unpack_from('<H', d, b)[0]; q = b + 10
                for _ in range(nt):
                    f0, f1 = struct.unpack_from('<HH', d, q); q += 17
                    nl = struct.unpack_from('<H', d, q)[0]
                    tags.setdefault(d[q + 2:q + 2 + nl].decode(), (f0, f1)); q += 2 + nl
            co += csize
        frames.append((dur, cels)); off += fsize
    for _, cels in frames:
        for li, c in list(cels.items()):
            if c[0] == 'link': cels[li] = frames[c[1]][1][li]
    return dict(w=w, h=h, layers=layers, frames=frames, tags=tags)

def layer_img(ase, fi, name):
    im = Image.new('RGBA', (ase['w'], ase['h']), (0, 0, 0, 0))
    c = ase['frames'][fi][1].get(ase['layers'].index(name))
    if c:
        x, y, cw, ch, px = c
        im.alpha_composite(Image.frombytes('RGBA', (cw, ch), px), (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))
    return im

def remap(im, table):
    if not table: return im
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            if p[3] and p[:3] in table: px[x, y] = table[p[:3]] + (p[3],)
    return im

# ---------------------------------------------------------------- what the game uses
TAGS = ['Idle', 'Idle_2', 'Idle_Ball_1', 'Dribble_1', 'Run', 'Run_Ball', 'Sprint_Ball', 'Slide', 'Jab',
        'Crossover', 'Hesi', 'Behind_Back', 'Side_Step', 'Between', 'Jumpshot', 'Jumpshot_2', 'Fadeaway_Left',
        'Layup', 'Dunk_1', 'Double_Clutch', 'Jump', 'Jump_TwoFeet_Ball', 'Steal', 'Block_1', 'Rebound_1', 'Free_Throw']
HAIRS = ['Hair1', 'Hair2', 'Hair4', 'Hair5', 'Hair7']
# Groups drawn in this order. Colors are nudged so every recolorable role has a unique key color.
GROUPS = {
    'body': (['Skin', 'Shoes', 'Socks', 'Shorts', 'Jersey'], {}),
    'stripes': (['Stripes_1'], {(255, 255, 255): (254, 254, 254)}),
    **{h.lower(): ([h], {}) for h in HAIRS},
    'band': (['Headband'], {(255, 255, 255): (253, 253, 253)}),
    'ball': (['Ball'], {}),
    'top': (['Skin_UP'], {}),
    'fx': (['Effects'], {}),
}
SHOE_FIX = {(122, 48, 69): (122, 48, 70), (232, 59, 59): (232, 59, 60), (46, 34, 47): (46, 34, 48)}

ase = read_ase(os.path.join(PACK, 'characters', 'character.aseprite'))
frames = sorted({f for t in TAGS for f in range(ase['tags'][t][0], ase['tags'][t][1] + 1)})
fidx = {f: i for i, f in enumerate(frames)}

pieces = []  # (key, image)
def add(key, im):
    bb = im.getbbox()
    if not bb: return
    pieces.append((key, im.crop(bb), bb))

for f in frames:
    for g, (layers, fix) in GROUPS.items():
        im = Image.new('RGBA', (ase['w'], ase['h']), (0, 0, 0, 0))
        for ln in layers:
            li = layer_img(ase, f, ln)
            if ln == 'Shoes': li = remap(li, SHOE_FIX)
            im.alpha_composite(li)
        add(f'{g}:{fidx[f]}', remap(im, fix))

court = Image.open(os.path.join(PACK, 'court', 'court.png')).convert('RGBA')
def crop(key, src, box):
    im = src.crop(box)
    pieces.append((key, im, (0, 0) + im.size))
crop('court', court, (528 + 216, 1216, 528 + 484, 1216 + 229))
crop('stand', court, (864, 33, 927, 127))
crop('rim', court, (16, 32, 32, 43))
crop('net', court, (33, 35, 47, 48))
for i, n in enumerate(['ball', 'ball_1', 'ball_2']):
    b = Image.open(os.path.join(PACK, 'ball', n + '.png')).convert('RGBA')
    crop(f'b{i}', b, (3, 4, 13, 14))
decor = Image.open(os.path.join(PACK, 'decor', 'Decor.png')).convert('RGBA')
for k, box in {'lamp2': (261, 22, 331, 96), 'lamp1': (336, 23, 352, 96), 'fence': (44, 44, 68, 96),
               'bench1': (81, 72, 111, 89), 'bench2': (113, 72, 143, 89), 'bench3': (145, 72, 175, 89),
               'trash': (48, 108, 64, 128), 'bottle': (100, 112, 108, 128), 'skate': (67, 116, 94, 127)}.items():
    crop(k, decor, box)
crop('grass', Image.open(os.path.join(PACK, 'decor', 'Grass.png')).convert('RGBA'), (0, 0, 48, 16))

# ---------------------------------------------------------------- shelf packing
W = 1024
order = sorted(range(len(pieces)), key=lambda i: -pieces[i][1].height)
x = y = rowh = 0; place = {}
for i in order:
    im = pieces[i][1]
    if x + im.width > W: x = 0; y += rowh + 1; rowh = 0
    place[i] = (x, y); x += im.width + 1; rowh = max(rowh, im.height)
H = y + rowh
atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
out = {}
for i, (key, im, bb) in enumerate(pieces):
    px, py = place[i]
    atlas.paste(im, (px, py))
    out[key] = [px, py, im.width, im.height, bb[0], bb[1]]

tags = {t: [fidx[ase['tags'][t][0]], fidx[ase['tags'][t][1]]] for t in TAGS}
durs = [ase['frames'][f][0] for f in frames]
os.makedirs(OUT, exist_ok=True)
atlas.save(os.path.join(OUT, 'atlas.png'), optimize=True)
json.dump({'size': [W, H], 'frames': len(frames), 'tags': tags, 'durs': durs, 'hairs': [h.lower() for h in HAIRS],
           'cell': [ase['w'], ase['h']], 'p': out}, open(os.path.join(OUT, 'atlas.json'), 'w'), separators=(',', ':'))
print(f'atlas {W}x{H}, {len(pieces)} pieces, {len(frames)} frames, {os.path.getsize(os.path.join(OUT, "atlas.png"))} bytes')
