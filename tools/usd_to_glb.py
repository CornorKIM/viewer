"""Fusion USDZ -> viewer GLB.

Output frame matches the existing viewer models: the viewer applies x1000 and rotation.x = +90deg
to gltf.scene, so file coords = (x, z, -y) / 1000 of the CAD mm (Z-up) coords.
Usage: python usd_to_glb.py OUT.glb NODE_NAME IN1.usdz [IN2.usdz ...]
"""
import json
import struct
import sys

import numpy as np
from pxr import Usd, UsdGeom, UsdShade

# No environment map in the viewer, so metallic surfaces would render black: keep metallic 0
# like the old models and only carry over color and (clamped) roughness.
ROUGHNESS_RANGE = (0.3, 0.9)


def shader_inputs(material):
    color, rough, opacity = (0.7, 0.7, 0.7), 0.5, 1.0
    if not material:
        return color, rough, opacity
    for prim in Usd.PrimRange(material.GetPrim()):
        shader = UsdShade.Shader(prim)
        if not shader or shader.GetIdAttr().Get() != 'UsdPreviewSurface':
            continue
        for name in ('diffuseColor', 'roughness', 'opacity'):
            inp = shader.GetInput(name)
            value = inp.Get() if inp else None
            if value is None:
                continue
            if name == 'diffuseColor':
                color = tuple(float(c) for c in value)
            elif name == 'roughness':
                rough = float(value)
            else:
                opacity = float(value)
        break
    return color, rough, opacity


def material_key(material):
    if not material:
        return 'Default'
    name = material.GetPrim().GetName()
    if name.startswith('XID_'):
        name = name[4:].rsplit('_', 1)[0]
    return name


def collect(paths):
    groups = {}  # material name -> {'info': ..., 'pos': [...], 'nrm': [...]}
    for path in paths:
        stage = Usd.Stage.Open(path)
        mm = UsdGeom.GetStageMetersPerUnit(stage) * 1000.0
        if UsdGeom.GetStageUpAxis(stage) != 'Z':
            raise SystemExit(f'{path}: expected Z-up stage')
        for prim in stage.Traverse():
            if not prim.IsA(UsdGeom.Mesh) or UsdGeom.Imageable(prim).ComputeVisibility() == 'invisible':
                continue
            mesh = UsdGeom.Mesh(prim)
            counts = np.array(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
            if counts.size == 0:
                continue
            if np.any(counts != 3):
                raise SystemExit(f'{prim.GetPath()}: non-triangle faces are not supported')
            idx = np.array(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64).reshape(-1, 3)
            if mesh.GetOrientationAttr().Get() == 'leftHanded':
                idx = idx[:, ::-1]
            xf = np.array(UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default()), dtype=np.float64)
            lin = xf[:3, :3]  # USD row-vector convention: p' = p @ M
            if np.linalg.det(lin) < 0:
                idx = idx[:, ::-1]
            pts = np.array(mesh.GetPointsAttr().Get(), dtype=np.float64) @ lin + xf[3, :3]
            pts *= mm

            corner_pos = pts[idx].reshape(-1, 3)
            normals = mesh.GetNormalsAttr().Get()
            interp = mesh.GetNormalsInterpolation()
            if normals is not None and len(normals):
                n = np.array(normals, dtype=np.float64)
                if interp in ('vertex', 'varying'):
                    corner_nrm = n[idx].reshape(-1, 3)
                elif interp == 'uniform':
                    corner_nrm = np.repeat(n, 3, axis=0)
                else:  # faceVarying
                    corner_nrm = n.reshape(-1, 3)
                corner_nrm = corner_nrm @ np.linalg.inv(lin).T
            else:
                tri = corner_pos.reshape(-1, 3, 3)
                face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
                corner_nrm = np.repeat(face, 3, axis=0)
            length = np.linalg.norm(corner_nrm, axis=1, keepdims=True)
            corner_nrm = np.divide(corner_nrm, length, out=np.zeros_like(corner_nrm), where=length > 0)

            material, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
            key = material_key(material)
            g = groups.setdefault(key, {'info': shader_inputs(material), 'pos': [], 'nrm': []})
            g['pos'].append(corner_pos)
            g['nrm'].append(corner_nrm)
    return groups


def to_viewer_frame(v, scale):
    # CAD (x, y, z) Z-up -> file (x, z, -y); viewer rotation.x = +90deg maps it back.
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1) * scale


def weld(pos, nrm):
    key = np.concatenate([np.round(pos, 4), np.round(nrm, 3)], axis=1)
    uniq, inverse = np.unique(key, axis=0, return_inverse=True)
    return uniq[:, :3].astype(np.float32), uniq[:, 3:].astype(np.float32), inverse.reshape(-1).astype(np.uint32)


def write_glb(out_path, node_name, groups):
    bin_parts, buffer_views, accessors, materials, primitives = [], [], [], [], []
    offset = 0

    def add_view(data, target):
        nonlocal offset
        raw = data.tobytes()
        pad = (-len(raw)) % 4
        bin_parts.append(raw + b'\x00' * pad)
        buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw), 'target': target})
        offset += len(raw) + pad
        return len(buffer_views) - 1

    total_v = total_t = 0
    for name, g in groups.items():
        pos = to_viewer_frame(np.concatenate(g['pos']), 0.001)
        nrm = to_viewer_frame(np.concatenate(g['nrm']), 1.0)
        p, n, ind = weld(pos, nrm)
        if p.shape[0] < 65536:
            ind = ind.astype(np.uint16)
        total_v += p.shape[0]
        total_t += ind.size // 3
        pv = add_view(p, 34962)
        accessors.append({'bufferView': pv, 'componentType': 5126, 'count': int(p.shape[0]), 'type': 'VEC3',
                          'min': p.min(axis=0).tolist(), 'max': p.max(axis=0).tolist()})
        pa = len(accessors) - 1
        nv = add_view(n, 34962)
        accessors.append({'bufferView': nv, 'componentType': 5126, 'count': int(n.shape[0]), 'type': 'VEC3'})
        na = len(accessors) - 1
        iv = add_view(ind, 34963)
        accessors.append({'bufferView': iv, 'componentType': 5123 if ind.dtype == np.uint16 else 5125,
                          'count': int(ind.size), 'type': 'SCALAR'})
        ia = len(accessors) - 1
        color, rough, opacity = g['info']
        mat = {'name': name, 'doubleSided': True,
               'pbrMetallicRoughness': {'baseColorFactor': [*color, opacity], 'metallicFactor': 0.0,
                                        'roughnessFactor': float(np.clip(rough, *ROUGHNESS_RANGE))}}
        if opacity < 1.0:
            mat['alphaMode'] = 'BLEND'
        materials.append(mat)
        primitives.append({'attributes': {'POSITION': pa, 'NORMAL': na}, 'indices': ia, 'material': len(materials) - 1})

    binary = b''.join(bin_parts)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'usd_to_glb.py (Fusion USDZ)'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': node_name, 'mesh': 0}],
        'meshes': [{'name': node_name, 'primitives': primitives}],
        'materials': materials, 'accessors': accessors, 'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(binary)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((-len(js)) % 4)
    with open(out_path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack('<I4s', len(js), b'JSON') + js)
        f.write(struct.pack('<I4s', len(binary), b'BIN\x00') + binary)
    print(f'{out_path}: {len(groups)} materials, {total_v} vertices, {total_t} triangles, {12 + 16 + len(js) + len(binary)} bytes')


if __name__ == '__main__':
    out, node_name, *inputs = sys.argv[1:]
    write_glb(out, node_name, collect(inputs))
