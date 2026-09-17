#!/usr/bin/env python3
"""Build a Triad Sketch scene from the mechazyme CALB / pNPA export (motif_01).

    python3 build_scene.py EXPORT_DIR/motif_01 calb.json [--yaw 0 --pitch 0]

Six keyframes from state_0*.sdf (positions, bond orders, formal charges), the built trajectory as the
motion between them (`path`), hydrogen bonds measured from the coordinates, the 14 curly arrows of
mechanism.mech.yaml, and one relabelling keyframe so the cycle closes with the products leaving and a
fresh substrate arriving instead of the products morphing back into the substrate.
Display choices, all of them stated in the README: side chains cut at CA, only polar hydrogens drawn,
Asp187 and Thr40 left out (15 A and 5-8 A from the chemistry), the nitro group's constant charges not
written, and the water shown from the state it enters.
"""
import json, math, os, sys

src = sys.argv[1]; out = sys.argv[2]
args = sys.argv[3:]; yaw = float(args[args.index('--yaw') + 1]) if '--yaw' in args else 0.0
pitch = float(args[args.index('--pitch') + 1]) if '--pitch' in args else 0.0
roll = float(args[args.index('--roll') + 1]) if '--roll' in args else 0.0
# the view is baked into the coordinates (a rigid rotation, nothing else), so the scene's own camera is yaw 0, pitch 0 and
# the app's orbit starts from the chosen orientation; roll is what yaw and pitch alone cannot give
def orient(p):
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw)); cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch)); cr, sr = math.cos(math.radians(roll)), math.sin(math.radians(roll))
    x, y, z = p; x, z = x * cy + z * sy, -x * sy + z * cy; y, z = y * cp - z * sp, y * sp + z * cp; x, y = x * cr - y * sr, x * sr + y * cr
    return [x, y, z]

# ---- atoms we draw, keyed by mechazyme atom map -------------------------------------------------------
NAME = {1: 'C1', 2: 'O2', 3: 'CM3', 4: 'O4', 5: 'CZ', 6: 'CE1', 7: 'CD1', 8: 'CG', 9: 'CD2', 10: 'CE2', 11: 'N', 12: 'O1', 13: 'O3',
        21: 'HG', 60: 'OW', 61: 'HW1', 62: 'HW2',
        20: 'OG', 22: 'CB', 23: 'CA', 40: 'CG', 41: 'ND1', 42: 'CE1', 43: 'NE2', 44: 'CD2', 45: 'HD1', 46: 'CA', 47: 'CB',
        80: 'CA', 81: 'CB', 82: 'CG', 83: 'CD', 84: 'OE1', 85: 'NE2'}
GROUP = {**{m: 'ACE' for m in (1, 2, 3)}, **{m: 'PNP' for m in range(4, 14)}, 21: 'SER105', 60: 'WAT', 61: 'WAT', 62: 'WAT',
         **{m: 'SER105' for m in (20, 22, 23)}, **{m: 'HIS224' for m in range(40, 48)}, **{m: 'GLN106' for m in range(80, 86)}}
RES = {'ACE': ('ACE', 1), 'PNP': ('PNP', 1), 'WAT': ('HOH', 1), 'SER105': ('SER', 105), 'HIS224': ('HIS', 224), 'GLN106': ('GLN', 106)}
CUT = {23, 46}              # CA atoms drawn as the pencil ball where the side chain is cut (Gln106's CA sits on the phenyl in projection, so it ends in a plain stub)

def read_sdf(path):
    atoms, bonds = {}, []
    for line in open(path):
        t = line.split()
        if len(t) >= 7 and t[0] == 'M' and t[1] == 'V30' and t[2].isdigit() and len(t[3]) <= 2 and not t[3].isdigit():
            idx, el = int(t[2]), t[3]; x, y, z = map(float, t[4:7]); amap = int(t[7]) if len(t) > 7 and t[7].lstrip('-').isdigit() else 0
            chg = 0
            for f in t[7:]:
                if f.startswith('CHG='): chg = int(f[4:])
            atoms[idx] = dict(el=el, pos=[x, y, z], map=amap, chg=chg)
        elif len(t) == 6 and t[0] == 'M' and t[1] == 'V30' and t[2].isdigit() and t[3].isdigit():
            bonds.append((int(t[4]), int(t[5]), int(t[3])))
    return atoms, bonds

key = json.load(open(os.path.join(src, 'atom_key.json')))
states = []
for k in range(6):
    sdf_atoms, sdf_bonds = read_sdf(os.path.join(src, f'state_{k:02d}.sdf'))
    kk = {a['serial']: a for a in key[f'state_{k:02d}']}
    # the SDF index is the PDB serial; atom maps for hydrogens come from atom_key
    bymap = {}
    for idx, a in sdf_atoms.items():
        m = kk[idx]['atom_map']; a['map'] = m; a['chg'] = kk[idx]['formal_charge']; bymap[m] = a
    states.append(dict(atoms=bymap, bonds=[(kk[a]['atom_map'], kk[b]['atom_map'], o) for a, b, o in sdf_bonds]))

# ---- the trajectory as paths ---------------------------------------------------------------------------
ser = json.load(open(os.path.join(src, 'chimerax', 'trajectory_serials.json')))
serial_of = {int(m): s for m, s in ser['serials'].items()}
frames = []; cur = None
for line in open(os.path.join(src, 'chimerax', 'trajectory.pdb')):
    if line.startswith('MODEL'): cur = {}
    elif line.startswith(('ATOM', 'HETATM')) and cur is not None: cur[int(line[6:11])] = [float(line[30:38]), float(line[38:46]), float(line[46:54])]
    elif line.startswith('ENDMDL'): frames.append(cur); cur = None
assert len(frames) == ser['frames'], len(frames)
fps = ser['frames_per_segment']

# polar hydrogens attached to drawn heavy atoms (Gln NE2's two, His HD1 is map 45)
def polar_hs(state):
    hs = set()
    for a, b, o in state['bonds']:
        for h, x in ((a, b), (b, a)):
            if state['atoms'][h]['el'] == 'H' and x in NAME and state['atoms'][x]['el'] in 'NO': hs.add(h)
    return hs

# ---- ids ------------------------------------------------------------------------------------------------
def atom_id(m, state, cycle=''):
    g = GROUP.get(m)
    if g is None:  # a polar hydrogen: attach it to its parent's group
        parent = next(x for a, b, o in state['bonds'] for h, x in ((a, b), (b, a)) if h == m)
        g = GROUP[parent]; nm = 'H' + NAME[parent][-3:] + str(m % 100)
    else: nm = NAME[m]
    return f'{g}{cycle}:{nm}'

def build_keyframe(k, cycle=''):
    st = states[k]; hs = polar_hs(st); drawn = set(NAME) | hs
    if k < 2: drawn -= {60, 61, 62}            # the water enters at state 2
    atoms = {}
    for m in sorted(drawn):
        if m not in st['atoms']: continue
        a = st['atoms'][m]; g = GROUP.get(m)
        aid = atom_id(m, st, cycle); grp = aid.split(':')[0]
        resn, resi = RES[grp.replace(cycle, '')] if grp.replace(cycle, '') in RES else ('UNK', 1)
        o = dict(el=a['el'], pos=[round(v, 3) for v in a['pos']], resn=resn, resi=resi, name=aid.split(':')[1], group=grp, het=grp.startswith(('ACE', 'PNP', 'WAT')))
        if m in CUT: o['sphere'] = True
        if a['chg'] and m not in (11, 12, 13): o['charge'] = a['chg']
        atoms[aid] = o
    bonds = []
    for a, b, o in st['bonds']:
        if a in drawn and b in drawn and a in st['atoms'] and b in st['atoms']:
            bonds.append([atom_id(a, st, cycle), atom_id(b, st, cycle), o])
    # hydrogen bonds: a drawn polar H within 2.4 A of a drawn N/O it is not bonded to
    bonded = {tuple(sorted((a, b))) for a, b, o in st['bonds']}
    for h in hs & drawn:
        hp = st['atoms'][h]['pos']
        for m in drawn:
            if m not in st['atoms'] or st['atoms'][m]['el'] not in 'NO' or tuple(sorted((h, m))) in bonded: continue
            if atom_id(h, st).split(':')[0] == atom_id(m, st).split(':')[0]: continue   # not within one residue
            d = math.dist(hp, st['atoms'][m]['pos'])
            if d < 2.4: bonds.append([atom_id(h, st, cycle), atom_id(m, st, cycle), 0])
    return atoms, bonds

# ---- lone pairs, only where an arrow starts -------------------------------------------------------------
def lp_dir(k, m):
    st = states[k]; a = st['atoms'][m]; v = [0.0, 0.0, 0.0]
    for x, y, o in st['bonds']:
        for p, q in ((x, y), (y, x)):
            if p == m and q in st['atoms']:
                d = [st['atoms'][q]['pos'][i] - a['pos'][i] for i in range(3)]; n = math.dist(d, [0, 0, 0]) or 1
                v = [v[i] - d[i] / n for i in range(3)]
    n = math.dist(v, [0, 0, 0]) or 1
    return [round(v[i] / n, 3) for i in range(3)]

# ---- arrows: mechanism.mech.yaml, tail -> head ------------------------------------------------------------
A = lambda m, k: atom_id(m, states[k])
ARROWS = {
    0: [dict(fr=('lp', 43), to=('bond', 43, 21)), dict(fr=('bond', 20, 21), to=('atom', 1)), dict(fr=('bond', 1, 2), to=('atom', 2))],
    1: [dict(fr=('lp', 2), to=('bond', 1, 2)), dict(fr=('bond', 1, 4), to=('atom', 4)), dict(fr=('lp', 4), to=('bond', 4, 21)), dict(fr=('bond', 43, 21), to=('atom', 43))],
    2: [dict(fr=('lp', 43), to=('bond', 43, 61)), dict(fr=('bond', 60, 61), to=('atom', 1)), dict(fr=('bond', 1, 2), to=('atom', 2))],
    3: [dict(fr=('lp', 2), to=('bond', 1, 2)), dict(fr=('bond', 1, 20), to=('atom', 20))],
    4: [dict(fr=('lp', 20), to=('bond', 20, 61)), dict(fr=('bond', 43, 61), to=('atom', 43))],
}
LP = {0: [43], 1: [2, 4], 2: [43], 3: [2], 4: [20]}

# screen projection for choosing the arrow's side: bow away from the drawing's centre
def screen(p): return p[0], -p[1]

def anchor_pos(anc, k, atoms):
    if anc[0] == 'atom' or anc[0] == 'lp': return atoms[A(anc[1], k)]['pos']
    p, q = atoms[A(anc[1], k)]['pos'], atoms[A(anc[2], k)]['pos']; return [(p[i] + q[i]) / 2 for i in range(3)]

def anchor(anc, k):
    if anc[0] == 'atom': return {'atom': A(anc[1], k)}
    if anc[0] == 'lp': return {'lp': A(anc[1], k), 'i': 0}
    return {'bond': [A(anc[1], k), A(anc[2], k)]}

CAPTION = ['Ser105 attacks the ester carbonyl; His224 takes the serine proton.',
           'The tetrahedral intermediate collapses; p-nitrophenol leaves with the proton His was holding.',
           'Water attacks the acyl-enzyme; His224 takes a proton from it.',
           'The second tetrahedral intermediate collapses and expels the serine alkoxide.',
           'His224 returns the proton to Ser105: acetic acid, p-nitrophenol, enzyme restored.',
           'Resting state: products present, catalytic residues regenerated.']
NAMES = ['Michaelis complex', 'Tetrahedral intermediate 1', 'Acyl-enzyme', 'Tetrahedral intermediate 2', 'Acetic acid and Ser alkoxide', 'Resting state']


# the trajectory's keyframes are the exported states to 0.001 A, except Gln106, which it carries as a rigid body;
# take every keyframe position from the trajectory so the motion is continuous through the keyframes
for k in range(6):
    fr = frames[fps * k]
    for m, a in states[k]['atoms'].items():
        if m in serial_of: a['pos'] = list(fr[serial_of[m]])
        a['pos'] = orient(a['pos'])
for fr in frames:
    for sidx in fr: fr[sidx] = orient(fr[sidx])

keyframes = []
for k in range(6):
    atoms, bonds = build_keyframe(k)
    for m in LP.get(k, []): atoms[A(m, k)]['lp'] = [lp_dir(k, m)]
    arrows = []
    if k in ARROWS:
        c = [sum(a['pos'][i] for a in atoms.values()) / len(atoms) for i in range(3)]; cxs, cys = screen(c)
        for ar in ARROWS[k]:
            p, q = anchor_pos(ar['fr'], k, atoms), anchor_pos(ar['to'], k, atoms)
            (x0, y0), (x1, y1) = screen(p), screen(q); mx, my = (x0 + x1) / 2, (y0 + y1) / 2
            nx, ny = -(y1 - y0), (x1 - x0)  # left normal in screen space
            side = 1 if (nx * (mx - cxs) + ny * (my - cys)) > 0 else -1
            arrows.append(dict({'from': anchor(ar['fr'], k), 'to': anchor(ar['to'], k)}, bulge=0.38, curl=0.8, side=side))
    kf = dict(name=NAMES[k], caption=CAPTION[k], hold=30, transition=60, atoms=atoms, bonds=bonds, arrows=arrows)
    if k < 5:
        path = []
        for f in range(fps * k + 1, fps * (k + 1)):          # frames strictly between the two keyframes (0-based index)
            pose = {}
            for m in NAME:
                if m in serial_of and m in states[k]['atoms'] and (k >= 1 or m not in (60, 61, 62)): pose[A(m, k)] = [round(v, 3) for v in frames[f][serial_of[m]]]
            for h in polar_hs(states[k]):
                if h in serial_of: pose[A(h, k)] = [round(v, 3) for v in frames[f][serial_of[h]]]
            path.append(pose)
        kf['path'] = path
    if k == 2:  # the water arrives from where the trajectory parks it
        for m in (60, 61, 62):
            atoms[A(m, 2)]['enterFrom'] = [round(v, 3) for v in frames[fps * 1][serial_of[m]]]
    keyframes.append(kf)
keyframes[5]['transition'] = 2

# ---- the relabelling keyframe: same pose as state 5, product ids retired, Ser's proton renamed ----------
atoms6, bonds6 = build_keyframe(5, cycle='')
ren = {}
for aid, a in list(atoms6.items()):
    g = aid.split(':')[0]
    if g in ('ACE', 'PNP', 'WAT'): ren[aid] = aid.replace(g + ':', g + '_out:')
# the proton now on Ser OG (HW1) becomes next cycle's HG; the one on the phenol leaves with it
ren['WAT:HW1'] = 'SER105:HG'
atoms6b = {}
exit_dir = None
site = atoms6['SER105:OG']['pos']
prod_c = [sum(atoms6[i]['pos'][j] for i in atoms6 if i.startswith(('ACE', 'PNP'))) / sum(1 for i in atoms6 if i.startswith(('ACE', 'PNP'))) for j in range(3)]
v = [prod_c[j] - site[j] for j in range(3)]; n = math.dist(v, [0, 0, 0]); exit_dir = [v[j] / n for j in range(3)]
for aid, a in atoms6.items():
    nid = ren.get(aid, aid); b = dict(a); b['name'] = nid.split(':')[1]; b['group'] = nid.split(':')[0]
    if nid.endswith('_out:' + b['name']) or '_out:' in nid:
        b['group'] = nid.split(':')[0].replace('_out', ''); b['exitTo'] = [round(a['pos'][j] + 6 * exit_dir[j], 3) for j in range(3)]
    if aid == 'SER105:HG':  # the old Ser proton, now on the phenol: leaves with it
        b['exitTo'] = [round(a['pos'][j] + 6 * exit_dir[j], 3) for j in range(3)]; nid = 'PNP_out:HG'; b['group'] = 'PNP'
    atoms6b[nid] = b
bonds6b = [[ren.get(a, a) if a != 'SER105:HG' else 'PNP_out:HG', ren.get(b, b) if b != 'SER105:HG' else 'PNP_out:HG', o] for a, b, o in bonds6]
keyframes.append(dict(name='Resting state', caption='', hold=0, transition=48, atoms=atoms6b, bonds=bonds6b, arrows=[]))
# the substrate of the next cycle arrives from another direction (the exit line turned 100 degrees in the picture plane), so
# it does not pass through the products on their way out
c, s_ = math.cos(math.radians(100)), math.sin(math.radians(100)); in_dir = [exit_dir[0] * c - exit_dir[1] * s_, exit_dir[0] * s_ + exit_dir[1] * c, exit_dir[2]]
for aid, a in keyframes[0]['atoms'].items():
    if aid.startswith(('ACE', 'PNP')): a['enterFrom'] = [round(a['pos'][j] + 7 * in_dir[j], 3) for j in range(3)]

scene = dict(name='CALB / p-nitrophenyl acetate, motif_01 (mechazyme)', reps={'sticks': 'all', 'cartoon': '', 'surface': ''},
             groupColors={'SER105': '#f97316', 'HIS224': '#fbbf24', 'GLN106': '#a8a29e', 'ACE': '#d6d3d1', 'PNP': '#7dd3fc', 'WAT': '#d6d3d1'},
             view={'yaw': 0, 'pitch': 0, 'zoom': 1, 'panX': 0, 'panY': 0, 'fov': 25, 'fog': 0.2, 'fogStart': 0.4}, keyframes=keyframes)
json.dump(scene, open(out, 'w'))
n_atoms = [len(k['atoms']) for k in keyframes]; print('keyframes', len(keyframes), 'atoms', n_atoms, 'bonds', [len(k['bonds']) for k in keyframes], 'path poses', [len(k.get('path', [])) for k in keyframes])
