#!/usr/bin/env python3
"""mech2scene: a Triad Sketch scene from computed reaction states, driven by a recipe.

    python3 tools/mech2scene.py STATES_DIR recipe.json out.json

STATES_DIR is a mechazyme export (one motif): state_00.sdf … state_0N.sdf (positions, bond orders, formal charges),
atom_key.json (serial → atom map, residue, name, element, charge, per state) and, optionally,
chimerax/trajectory.pdb + trajectory_serials.json (the built trajectory between the states). Anything with the same
files works; docs/hero-workflow.md describes the layout.

The recipe says what to draw and how the cycle reads; docs/hero-workflow.md documents every key, and
hero/calb/recipe.json is a complete example. Coordinates are never changed: the view goes into the scene's camera
(yaw, pitch, roll), the exit and entry of molecules are the engine's `leave` / `asNext` / `exitDir` / `enterDir`.
"""
import json, math, os, sys

if len(sys.argv) < 4: print(__doc__); sys.exit(1)
src, recipe_path, out = sys.argv[1:4]
R = json.load(open(recipe_path))

# ---- recipe -----------------------------------------------------------------------------------------------
NAME = {int(k): v for k, v in R['atoms'].items()}                          # atom map → drawn name (heavy atoms)
GROUP = {}                                                                  # atom map → group (colour, leave, ids)
for g, maps in R['groups'].items():
    for m in maps: GROUP[int(m)] = g
RES = {g: tuple(v) for g, v in R.get('residues', {}).items()}               # group → (resn, resi) for the ids the app parses
CUT = set(int(m) for m in R.get('cut', []))                                 # CA atoms drawn as the pencil ball
HIDE_CHARGE = set(int(m) for m in R.get('hideCharges', []))
ENTER_AT = {g: int(k) for g, k in R.get('enterAt', {}).items()}            # group → first state it is drawn in
HOLD, TRANS = R.get('hold', 30), R.get('transition', 60)
HBOND_MAX = R.get('hbondMax', 2.4)
view = R.get('view', {})
yaw, pitch, roll = view.get('yaw', 0), view.get('pitch', 0), view.get('roll', 0)

def read_sdf(path):
    atoms, bonds = {}, []
    for line in open(path):
        t = line.split()
        if len(t) >= 7 and t[0] == 'M' and t[1] == 'V30' and t[2].isdigit() and len(t[3]) <= 2 and not t[3].isdigit():
            atoms[int(t[2])] = dict(el=t[3], pos=[float(t[4]), float(t[5]), float(t[6])])
        elif len(t) == 6 and t[0] == 'M' and t[1] == 'V30' and t[2].isdigit() and t[3].isdigit():
            bonds.append((int(t[4]), int(t[5]), int(t[3])))
    return atoms, bonds

key = json.load(open(os.path.join(src, 'atom_key.json')))
n_states = len([k for k in key if k.startswith('state_')])
states = []
for k in range(n_states):
    sdf_atoms, sdf_bonds = read_sdf(os.path.join(src, f'state_{k:02d}.sdf'))
    kk = {a['serial']: a for a in key[f'state_{k:02d}']}
    bymap = {}
    for idx, a in sdf_atoms.items():
        m = kk[idx]['atom_map']; a['map'] = m; a['chg'] = kk[idx]['formal_charge']; bymap[m] = a
    states.append(dict(atoms=bymap, bonds=[(kk[a]['atom_map'], kk[b]['atom_map'], o) for a, b, o in sdf_bonds]))

# the trajectory, when there is one: keyframe positions from it (so the motion is continuous through the keyframes) and
# the rows between two states as the keyframe's `path`
frames, fps, serial_of = [], 0, {}
tp = os.path.join(src, 'chimerax', 'trajectory.pdb')
if os.path.exists(tp) and R.get('trajectory', True):
    ser = json.load(open(os.path.join(src, 'chimerax', 'trajectory_serials.json')))
    serial_of = {int(m): s for m, s in ser['serials'].items()}; cur = None
    for line in open(tp):
        if line.startswith('MODEL'): cur = {}
        elif line.startswith(('ATOM', 'HETATM')) and cur is not None: cur[int(line[6:11])] = [float(line[30:38]), float(line[38:46]), float(line[46:54])]
        elif line.startswith('ENDMDL'): frames.append(cur); cur = None
    fps = ser['frames_per_segment']
    for k in range(n_states):
        fr = frames[fps * k]
        for m, a in states[k]['atoms'].items():
            if m in serial_of: a['pos'] = list(fr[serial_of[m]])

def polar_hs(state):
    hs = set()
    for a, b, o in state['bonds']:
        for h, x in ((a, b), (b, a)):
            if state['atoms'][h]['el'] == 'H' and x in NAME and state['atoms'][x]['el'] in 'NO': hs.add(h)
    return hs

def atom_id(m, state):
    g = GROUP.get(m)
    if g is None:   # a polar hydrogen: it belongs to its parent's group, named after the parent
        parent = next((x for a, b, o in state['bonds'] for h, x in ((a, b), (b, a)) if h == m and x in NAME), None)
        if parent is None: return None
        return f'{GROUP[parent]}:H{NAME[parent][-3:]}{m % 100}'
    return f'{g}:{NAME[m]}'
_idmaps = {}
def idmap(k):   # atom map → id for everything drawable in state k
    if k not in _idmaps: _idmaps[k] = {m: atom_id(m, states[k]) for m in states[k]['atoms'] if m in NAME or m in polar_hs(states[k])}
    return _idmaps[k]

def build_keyframe(k):
    st = states[k]; hs = polar_hs(st) if R.get('hydrogens', 'polar') == 'polar' else set()
    drawn = {m for m in NAME if ENTER_AT.get(GROUP.get(m), 0) <= k} | {h for h in hs}
    atoms = {}
    for m in sorted(drawn):
        if m not in st['atoms']: continue
        a = st['atoms'][m]; aid = atom_id(m, st); grp = aid.split(':')[0]
        if ENTER_AT.get(grp, 0) > k: continue
        resn, resi = RES.get(grp, (grp[:3], 1))
        o = dict(el=a['el'], pos=[round(v, 3) for v in a['pos']], resn=resn, resi=resi, name=aid.split(':')[1], group=grp, het=grp in R.get('het', []))
        if m in CUT: o['sphere'] = True
        if a['chg'] and m not in HIDE_CHARGE: o['charge'] = a['chg']
        atoms[aid] = o
    bonds = []
    for a, b, o in st['bonds']:
        if a in st['atoms'] and b in st['atoms']:
            ia, ib = (atom_id(a, st) if (a in NAME or a in hs) else None), (atom_id(b, st) if (b in NAME or b in hs) else None)
            if ia in atoms and ib in atoms: bonds.append([ia, ib, o])
    bonded = {tuple(sorted((a, b))) for a, b, o in st['bonds']}
    for h in hs:                      # hydrogen bonds, measured: a drawn polar H near an N/O of another residue it is not bonded to
        ih = atom_id(h, st)
        if ih not in atoms: continue
        for m in NAME:
            if m not in st['atoms'] or st['atoms'][m]['el'] not in 'NO' or tuple(sorted((h, m))) in bonded: continue
            im = atom_id(m, st)
            if im not in atoms or im.split(':')[0] == ih.split(':')[0]: continue
            if math.dist(st['atoms'][h]['pos'], st['atoms'][m]['pos']) < HBOND_MAX: bonds.append([ih, im, 0])
    return atoms, bonds

def lp_dir(k, m):     # away from the atom's bonds
    st = states[k]; a = st['atoms'][m]; v = [0.0, 0.0, 0.0]
    for x, y, o in st['bonds']:
        for p, q in ((x, y), (y, x)):
            if p == m and q in st['atoms']:
                d = [st['atoms'][q]['pos'][i] - a['pos'][i] for i in range(3)]; n = math.dist(d, [0, 0, 0]) or 1
                v = [v[i] - d[i] / n for i in range(3)]
    n = math.dist(v, [0, 0, 0]) or 1
    return [round(v[i] / n, 3) for i in range(3)]

# screen projection with the recipe's camera, to bow each arrow away from the drawing's centre
cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw)); cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch)); cr, sr = math.cos(math.radians(roll)), math.sin(math.radians(roll))
def screen(p):
    x, y, z = p; x, z = x * cy + z * sy, -x * sy + z * cy; y, z = y * cp - z * sp, y * sp + z * cp; x, y = x * cr - y * sr, x * sr + y * cr
    return x, -y

def anchor(spec, k):
    st = states[k]
    if spec[0] == 'atom': return {'atom': atom_id(spec[1], st)}
    if spec[0] == 'lp': return {'lp': atom_id(spec[1], st), 'i': 0}
    return {'bond': [atom_id(spec[1], st), atom_id(spec[2], st)]}
def anchor_pos(spec, k, atoms):
    st = states[k]
    if spec[0] in ('atom', 'lp'): return atoms[atom_id(spec[1], st)]['pos']
    p, q = atoms[atom_id(spec[1], st)]['pos'], atoms[atom_id(spec[2], st)]['pos']; return [(p[i] + q[i]) / 2 for i in range(3)]

keyframes = []
for k in range(n_states):
    atoms, bonds = build_keyframe(k)
    for m in R.get('lonePairs', {}).get(str(k), []): atoms[atom_id(m, states[k])]['lp'] = [lp_dir(k, m)]
    arrows = []
    c = [sum(a['pos'][i] for a in atoms.values()) / len(atoms) for i in range(3)]; cxs, cys = screen(c)
    for ar in R.get('arrows', {}).get(str(k), []):
        fr, to = ar['from'], ar['to']
        p, q = anchor_pos(fr, k, atoms), anchor_pos(to, k, atoms)
        (x0, y0), (x1, y1) = screen(p), screen(q); mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        nx, ny = -(y1 - y0), (x1 - x0)
        side = ar.get('side') or (1 if (nx * (mx - cxs) + ny * (my - cys)) > 0 else -1)
        arrows.append({'from': anchor(fr, k), 'to': anchor(to, k), 'bulge': ar.get('bulge', 0.38), 'curl': ar.get('curl', 0.8), 'side': side})
    kf = dict(name=R.get('names', [f'state {k}'] * n_states)[k], caption=R.get('captions', [''] * n_states)[k], hold=HOLD, transition=TRANS, atoms=atoms, bonds=bonds, arrows=arrows)
    if frames and k < n_states - 1:
        path = []
        for f in range(fps * k + 1, fps * (k + 1)):
            pose = {}
            for m, aid in idmap(k).items():
                if aid in atoms and m in serial_of: pose[aid] = [round(v, 3) for v in frames[f][serial_of[m]]]
            path.append(pose)
        kf['path'] = path
    for g, at in ENTER_AT.items():   # a group that enters here arrives from where the trajectory parked it, if there is one
        if at == k and frames and k > 0:
            for m, aid in idmap(k).items():
                if aid in atoms and aid.startswith(g + ':') and m in serial_of: atoms[aid]['enterFrom'] = [round(v, 3) for v in frames[fps * (k - 1)][serial_of[m]]]
    keyframes.append(kf)

# closing the cycle
L = R.get('loop')
if L:
    last = keyframes[-1]; atoms = last['atoms']
    site = atoms[L['site']]['pos']
    prod = [i for i in atoms if i.split(':')[0] in L['leave']]
    c = [sum(atoms[i]['pos'][j] for i in prod) / len(prod) for j in range(3)]
    v = [c[j] - site[j] for j in range(3)]; n = math.dist(v, [0, 0, 0]); ex = [v[j] / n for j in range(3)]
    t = math.radians(L.get('enterTurn', 100)); ct, st_ = math.cos(t), math.sin(t)
    # the entry direction: the exit line turned in the picture plane, so the substrate does not pass through the products
    ex_s = screen(ex); ang = math.atan2(ex_s[1], ex_s[0]) + t
    # build a 3D direction with that screen angle: rotate ex about the view axis by t (view axis = third row of the rotation)
    def rot(p):
        x, y, z = p; x, z = x * cy + z * sy, -x * sy + z * cy; y, z = y * cp - z * sp, y * sp + z * cp; x, y = x * cr - y * sr, x * sr + y * cr; return [x, y, z]
    def unrot(p):
        x, y, z = p; x, y = x * cr + y * sr, -x * sr + y * cr; y, z = y * cp + z * sp, -y * sp + z * cp; x, z = x * cy - z * sy, x * sy + z * cy; return [x, y, z]
    e = rot(ex); e2 = [e[0] * ct - e[1] * st_, e[0] * st_ + e[1] * ct, e[2]]; en = unrot(e2)
    last['transition'] = L.get('transition', 48)
    last['leave'] = L['leave'] + L.get('leaveAtoms', [])
    if L.get('asNext'): last['asNext'] = L['asNext']
    last['exitDir'] = [round(L.get('exitDistance', 6) * d, 3) for d in ex]
    keyframes[0]['enterDir'] = [round(L.get('enterDistance', 7) * d, 3) for d in en]

scene = dict(name=R.get('name', os.path.basename(os.path.abspath(src))), reps={'sticks': 'all', 'cartoon': '', 'surface': ''}, groupColors=R.get('colors', {}),
             view={'yaw': yaw, 'pitch': pitch, 'roll': roll, 'zoom': view.get('zoom', 1), 'panX': view.get('panX', 0), 'panY': view.get('panY', 0), 'fov': view.get('fov', 25), 'fog': view.get('fog', 0.2), 'fogStart': view.get('fogStart', 0.4)}, keyframes=keyframes)
json.dump(scene, open(out, 'w'))
print(f'{out}: {len(keyframes)} keyframes, atoms {[len(k["atoms"]) for k in keyframes]}, bonds {[len(k["bonds"]) for k in keyframes]}, paths {[len(k.get("path", [])) for k in keyframes]}')
