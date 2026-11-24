// Court geometry shared by the pixel match and renderer. Same meters as the 3D version (and rules.ts):
// x 0..15 across, y 0..11 from the baseline, h up. World vectors keep the 3D convention
// (X = x - 7.5, Y = h, Z = y - 5.5) so the match code can reuse its curves unchanged.
import { Curve, Vector3 } from 'three';

export const COURT_W = 15;
export const COURT_H = 11;
export const HOOP = { x: 7.5, y: 1.575 };
export const RIM_H = 3.05;

export const w3 = (x: number, y: number, h = 0) => new Vector3(x - COURT_W / 2, h, y - COURT_H / 2);
export const RIM = w3(HOOP.x, HOOP.y, RIM_H);

/** A parabolic arc between two points with a given apex height above the higher end. */
export class ArcCurve extends Curve<Vector3> {
  constructor(public a: Vector3, public b: Vector3, public apex: number) { super(); }
  getPoint(t: number, target = new Vector3()) {
    target.lerpVectors(this.a, this.b, t);
    const top = Math.max(this.a.y, this.b.y) + this.apex;
    const lin = this.a.y + (this.b.y - this.a.y) * t;
    const peak = top - (this.a.y + this.b.y) / 2;
    target.y = lin + Math.sin(Math.PI * t) * peak;
    return target;
  }
}
