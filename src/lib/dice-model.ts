import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
} from 'three';

export type Face = { value: number; normal: Vector3; center: Vector3 };
export type DieModel = { geometry: BufferGeometry; faces: Face[] };

export function visualSides(sides: number) {
  return [4, 6, 8, 10, 12, 20].includes(sides) ? sides : 6;
}

function triangles(geometry: BufferGeometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const attr = g.getAttribute('position');
  const points: Vector3[] = [];
  const faces: number[][] = [];
  for (let i = 0; i < attr.count; i += 3) {
    const face: number[] = [];
    for (let j = 0; j < 3; j++) {
      const point = new Vector3().fromBufferAttribute(attr, i + j);
      let index = points.findIndex((p) => p.distanceToSquared(point) < 1e-9);
      if (index < 0) {
        index = points.length;
        points.push(point);
      }
      face.push(index);
    }
    faces.push(face);
  }
  return { points, faces };
}

function dodecahedron() {
  // The regular dodecahedron is the dual of the icosahedron: each vertex of
  // the icosahedron becomes one pentagonal face with five coplanar vertices.
  const ico = triangles(new IcosahedronGeometry(1, 0));
  const points = ico.faces.map((face) =>
    face
      .reduce((sum, i) => sum.add(ico.points[i]), new Vector3())
      .divideScalar(3)
      .normalize(),
  );
  const faces = ico.points.map((vertex) => {
    const attached = ico.faces
      .map((face, index) => (face.includes(ico.points.indexOf(vertex)) ? index : -1))
      .filter((index) => index >= 0);
    const normal = vertex.clone().normalize();
    const axis = new Vector3(0, 1, 0).cross(normal).normalize();
    if (axis.lengthSq() < 0.001) axis.set(1, 0, 0);
    const other = normal.clone().cross(axis);
    return attached.sort((a, b) => {
      const angle = (i: number) => Math.atan2(points[i].dot(other), points[i].dot(axis));
      return angle(a) - angle(b);
    });
  });
  return { points, faces };
}

function tenSided() {
  const a = 0.12;
  const h = (a * (1 + Math.cos(Math.PI / 5))) / (1 - Math.cos(Math.PI / 5));
  const points: Vector3[] = [new Vector3(0, h, 0), new Vector3(0, -h, 0)];
  for (let i = 0; i < 5; i++) {
    const angle = (i * 2 * Math.PI) / 5;
    points.push(new Vector3(Math.cos(angle), a, Math.sin(angle)));
    points.push(new Vector3(Math.cos(angle + Math.PI / 5), -a, Math.sin(angle + Math.PI / 5)));
  }
  const faces: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const upper = 2 + i * 2,
      lower = upper + 1,
      nextUpper = 2 + ((i + 1) % 5) * 2,
      nextLower = nextUpper + 1;
    faces.push([0, upper, lower, nextUpper], [1, lower, nextLower, nextUpper]);
  }
  return { points, faces };
}

function numberFaces(normals: Vector3[], sides: number) {
  const values = Array<number>(sides).fill(0);
  if (sides === 4) return values.map((_, i) => i + 1);
  const remaining = new Set(normals.map((_, i) => i));
  let low = sides === 10 ? 0 : 1;
  let high = sides === 10 ? 9 : sides;
  while (remaining.size) {
    const first = remaining.values().next().value as number;
    remaining.delete(first);
    let opposite = -1,
      min = Infinity;
    for (const candidate of remaining) {
      const dot = normals[first].dot(normals[candidate]);
      if (dot < min) {
        min = dot;
        opposite = candidate;
      }
    }
    if (opposite < 0) throw new Error('Unpaired die face');
    remaining.delete(opposite);
    values[first] = low++;
    values[opposite] = high--;
  }
  return values;
}

export function buildDieModel(sides: number): DieModel {
  const shape = visualSides(sides);
  const raw =
    shape === 4
      ? triangles(new TetrahedronGeometry(1))
      : shape === 6
        ? triangles(new BoxGeometry(1.45, 1.45, 1.45))
        : shape === 8
          ? triangles(new OctahedronGeometry(1))
          : shape === 10
            ? tenSided()
            : shape === 12
              ? dodecahedron()
              : triangles(new IcosahedronGeometry(1));
  // Built-in cube triangles are co-planar; merge by face normal to make 6 faces.
  const polygons =
    shape === 6
      ? Array.from({ length: 6 }, (_, i) => {
          const adjacent = raw.faces.slice(i * 2, i * 2 + 2).flat();
          return Array.from(new Set(adjacent));
        })
      : raw.faces;
  const faces = polygons.map((poly) => {
    const center = poly
      .reduce((sum, i) => sum.add(raw.points[i]), new Vector3())
      .divideScalar(poly.length);
    return { center, normal: center.clone().normalize() };
  });
  const positions: number[] = [];
  polygons.forEach((poly, index) => {
    const normal = faces[index].normal;
    // Sort vertices in the face plane for correct triangulation and winding.
    const axis = new Vector3(0, 1, 0).cross(normal).normalize();
    if (axis.lengthSq() < 0.001) axis.set(1, 0, 0);
    const other = normal.clone().cross(axis);
    const ordered = [...poly].sort((a, b) => {
      const angle = (i: number) => {
        const p = raw.points[i].clone().sub(faces[index].center);
        return Math.atan2(p.dot(other), p.dot(axis));
      };
      return angle(a) - angle(b);
    });
    for (let j = 1; j < ordered.length - 1; j++)
      for (const k of [ordered[0], ordered[j], ordered[j + 1]])
        positions.push(...raw.points[k].toArray());
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  if (faces.length !== shape) throw new Error(`Invalid d${shape} geometry: ${faces.length} faces`);
  const values = numberFaces(
    faces.map((f) => f.normal),
    shape,
  );
  return { geometry, faces: faces.map((f, i) => ({ ...f, value: values[i] })) };
}

export function landingRotation(model: DieModel, value: number) {
  const printed = model.faces.length === 10 && value === 10 ? 0 : value;
  const face = model.faces.find((f) => f.value === printed);
  if (!face) throw new Error('Outcome has no matching face');
  const rotation = new Quaternion().setFromUnitVectors(face.normal, new Vector3(0, 1, 0));
  // Match the label plane's local up direction to the top of the top-down screen.
  const labelRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), face.normal);
  const labelUp = new Vector3(0, 1, 0).applyQuaternion(labelRotation).applyQuaternion(rotation);
  const upright = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.atan2(labelUp.x, -labelUp.z),
  );
  return upright.multiply(rotation);
}
