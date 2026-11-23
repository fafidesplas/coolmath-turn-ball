// Three.js scene: low-poly street court, players, ball, camera rig, previews and world labels.
// Court coordinates (meters): x 0..15 across, y 0..11 from the baseline. World: X = x - 7.5, Z = y - 5.5, Y up.
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export const COURT_W = 15;
export const COURT_H = 11;
export const HOOP = { x: 7.5, y: 1.575 };
export const RIM_H = 3.05;
export const ARC_R = 6.75;
export const CORNER_DX = 6.6;

export const w3 = (x: number, y: number, h = 0) => new THREE.Vector3(x - COURT_W / 2, h, y - COURT_H / 2);
export const RIM = w3(HOOP.x, HOOP.y, RIM_H);

const isCoarse = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

export interface PlayerLook {
  jersey: string;
  shorts: string;
  accent: string;
  skin: string;
  hair: string;
  num: number;
  team: 0 | 1;
}

export interface PoseState {
  x: number;
  y: number;
  face: number;
  jump: number;
  armsUp: number;
  daze: boolean;
  moving: boolean;
}

class PlayerView {
  root = new THREE.Group();
  body = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  ring: THREE.Mesh;
  stars = new THREE.Group();
  shadow: THREE.Mesh;
  private runT = Math.random() * 10;

  constructor(look: PlayerLook, shared: Shared) {
    const lam = (c: string) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const skin = lam(look.skin);
    const jersey = lam(look.jersey);
    const shorts = lam(look.shorts);
    const hair = lam(look.hair);
    const shoe = lam(look.team === 0 ? '#ffffff' : '#20202a');

    const legGeo = new THREE.CylinderGeometry(0.1, 0.085, 0.72, 6);
    legGeo.translate(0, -0.36, 0);
    this.legL = new THREE.Mesh(legGeo, skin);
    this.legR = new THREE.Mesh(legGeo, skin);
    this.legL.position.set(-0.13, 0.78, 0);
    this.legR.position.set(0.13, 0.78, 0);
    const shoeGeo = new THREE.BoxGeometry(0.17, 0.11, 0.3);
    shoeGeo.translate(0, -0.7, 0.05);
    this.legL.add(new THREE.Mesh(shoeGeo, shoe));
    this.legR.add(new THREE.Mesh(shoeGeo, shoe));

    const shortsM = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.34, 8), shorts);
    shortsM.position.y = 0.86;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.64, 8), jersey);
    torso.position.y = 1.32;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 4, 10), lam(look.accent));
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 1.63;

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), skin);
    head.position.y = 1.95;
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.285, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairM.position.y = 1.98;
    hairM.rotation.x = -0.25;
    const eyeGeo = new THREE.SphereGeometry(0.045, 6, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#141018' });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 1.97, 0.24);
    eyeR.position.set(0.1, 1.97, 0.24);

    const armGeo = new THREE.CylinderGeometry(0.075, 0.065, 0.62, 6);
    armGeo.translate(0, -0.31, 0);
    const armMeshL = new THREE.Mesh(armGeo, skin);
    const armMeshR = new THREE.Mesh(armGeo, skin);
    const sleeve = new THREE.CylinderGeometry(0.1, 0.09, 0.2, 6);
    sleeve.translate(0, -0.08, 0);
    this.armL.add(armMeshL, new THREE.Mesh(sleeve, jersey));
    this.armR.add(armMeshR, new THREE.Mesh(sleeve, jersey));
    this.armL.position.set(-0.36, 1.58, 0);
    this.armR.position.set(0.36, 1.58, 0);

    // Big number on the back (the third-person camera sees it) and a small one on the chest.
    const numTex = shared.numberTexture(look.num, look.accent);
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), numMat);
    back.position.set(0, 1.34, -0.285);
    back.rotation.y = Math.PI;
    const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), numMat);
    chest.position.set(0, 1.4, 0.29);

    this.body.add(this.legL, this.legR, shortsM, torso, trim, head, hairM, eyeL, eyeR, this.armL, this.armR, back, chest);
    this.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });

    this.ring = new THREE.Mesh(shared.ringGeo, new THREE.MeshBasicMaterial({ color: look.jersey, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.shadow = new THREE.Mesh(shared.blobGeo, shared.blobMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;

    const starMat = new THREE.MeshBasicMaterial({ color: '#ffd60a' });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), starMat);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
      this.stars.add(s);
    }
    this.stars.position.y = 2.45;
    this.stars.visible = false;

    this.root.add(this.shadow, this.ring, this.body, this.stars);
  }

  update(s: PoseState, dt: number) {
    const p = w3(s.x, s.y);
    this.root.position.set(p.x, 0, p.z);
    // Smooth turning.
    const target = s.face;
    let d = target - this.body.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.body.rotation.y += d * Math.min(1, dt * 12);
    this.runT += dt * (s.moving ? 11 : 2.2);
    const swing = s.moving ? Math.sin(this.runT) * 0.7 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    const bob = s.moving ? Math.abs(Math.sin(this.runT)) * 0.06 : Math.sin(this.runT) * 0.015;
    this.body.position.y = s.jump + bob;
    const up = s.armsUp;
    this.armL.rotation.x = -swing * 0.8 * (1 - up) - up * 2.9;
    this.armR.rotation.x = swing * 0.8 * (1 - up) - up * 2.9;
    this.armL.rotation.z = -0.12 - up * 0.15;
    this.armR.rotation.z = 0.12 + up * 0.15;
    const sh = 1 - Math.min(0.5, s.jump * 0.4);
    this.shadow.scale.setScalar(sh);
    this.stars.visible = s.daze;
    if (s.daze) {
      this.stars.rotation.y += dt * 6;
      this.stars.position.y = 2.45 + s.jump;
    }
  }

  setRing(color: string, opacity: number) {
    const m = this.ring.material as THREE.MeshBasicMaterial;
    m.color.set(color);
    m.opacity = opacity;
  }
}

class Shared {
  ringGeo = new THREE.RingGeometry(0.42, 0.55, 28);
  blobGeo = new THREE.CircleGeometry(0.55, 20);
  blobMat: THREE.MeshBasicMaterial;
  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  }
  numberTexture(num: number, color: string) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.font = '900 92px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.strokeText(String(num), 64, 70);
    g.fillStyle = color;
    g.fillText(String(num), 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

/** A flowing dotted path (ghost trajectory). */
class DotPath {
  mesh: THREE.InstancedMesh;
  private n: number;
  private phase = 0;
  private m = new THREE.Matrix4();
  constructor(private curve: THREE.Curve<THREE.Vector3>, color: string, radius: number, spacing: number, private speed = 0.9) {
    const len = curve.getLength();
    this.n = Math.max(3, Math.round(len / spacing));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 8, 6), mat, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.update(0);
  }
  update(dt: number) {
    this.phase = (this.phase + dt * this.speed) % 1;
    const p = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const t = Math.min(1, (i + this.phase) / this.n);
      this.curve.getPointAt(t, p);
      const s = 0.7 + 0.3 * Math.sin((i / this.n) * Math.PI);
      this.m.makeScale(s, s, s).setPosition(p);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** A parabolic 3D arc between two points with a given apex height above the higher end. */
export class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(public a: THREE.Vector3, public b: THREE.Vector3, public apex: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    target.lerpVectors(this.a, this.b, t);
    const top = Math.max(this.a.y, this.b.y) + this.apex;
    // Quadratic through a, b with peak `top` approximated with a sine bump on top of the lerp.
    const lin = this.a.y + (this.b.y - this.a.y) * t;
    const peak = top - (this.a.y + this.b.y) / 2;
    target.y = lin + Math.sin(Math.PI * t) * peak;
    return target;
  }
}

export interface LabelSpec {
  pos: THREE.Vector3;
  html: string;
  cls?: string;
}

interface Floater { obj: CSS2DObject; t: number; base: THREE.Vector3 }

export class World {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  players: PlayerView[] = [];
  ball: THREE.Mesh;
  private shared = new Shared();
  private handlerMarker: THREE.Group;
  private controlMarker: THREE.Mesh;
  private targetMarker: THREE.Mesh;
  private preview = new THREE.Group();
  private dotPaths: DotPath[] = [];
  private pulses: THREE.Object3D[] = [];
  private floaters: Floater[] = [];
  private camPos = new THREE.Vector3(0, 14, 12);
  private camLook = new THREE.Vector3(0, 0, -2);
  private wantPos = new THREE.Vector3(0, 14, 12);
  private wantLook = new THREE.Vector3(0, 0, -2);
  private camSpeed = 3;
  private time = 0;
  private ro: ResizeObserver;
  private net: THREE.Mesh;
  private netKick = 0;
  private rim: THREE.Mesh;
  private rimKick = 0;
  shake = 0;

  constructor(private container: HTMLElement, looks: PlayerLook[]) {
    const coarse = isCoarse();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'gl';
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.buildEnvironment();
    this.buildCourt();
    const hoop = this.buildHoop();
    this.net = hoop.net;
    this.rim = hoop.rim;

    for (const look of looks) {
      const pv = new PlayerView(look, this.shared);
      this.players.push(pv);
      this.scene.add(pv.root);
    }

    const ballTex = this.ballTexture();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), new THREE.MeshLambertMaterial({ map: ballTex }));
    this.scene.add(this.ball);

    // Ball handler: pulsing gold ring + floating gem above the head.
    this.handlerMarker = new THREE.Group();
    const hr = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.78, 32), new THREE.MeshBasicMaterial({ color: '#ffd60a', transparent: true, opacity: 0.9, depthWrite: false }));
    hr.rotation.x = -Math.PI / 2;
    hr.position.y = 0.025;
    const gem = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 4), new THREE.MeshBasicMaterial({ color: '#ffd60a' }));
    gem.rotation.x = Math.PI;
    gem.position.y = 2.75;
    gem.name = 'gem';
    this.handlerMarker.add(hr, gem);
    this.scene.add(this.handlerMarker);

    // Controlled player (when not the handler): white chevron.
    this.controlMarker = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.26, 3), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.controlMarker.rotation.x = Math.PI;
    this.scene.add(this.controlMarker);

    this.targetMarker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }));
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.visible = false;
    this.scene.add(this.targetMarker);

    this.scene.add(this.preview);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  destroy() {
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.container.innerHTML = '';
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- build ----------------
  private buildEnvironment() {
    const sky = document.createElement('canvas');
    sky.width = 4; sky.height = 256;
    const g = sky.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3b2a6b');
    grd.addColorStop(0.55, '#c8577a');
    grd.addColorStop(1, '#ffb36b');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog('#d98a7c', 30, 70);

    this.scene.add(new THREE.HemisphereLight('#ffe9d6', '#5b4a6b', 1.6));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    sun.position.set(-8, 14, 10);
    this.scene.add(sun);
    const rimLight = new THREE.DirectionalLight('#9ec5ff', 0.9);
    rimLight.position.set(10, 6, -12);
    this.scene.add(rimLight);

    const lam = (c: string) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), lam('#4a4458'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W + 4, COURT_H + 5), lam('#2f6f5e'));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, -0.01, 0.8);
    this.scene.add(apron);

    // Low wall + fence posts behind the baseline and along the sides.
    const wallMat = lam('#7a4f8c');
    const wall = new THREE.Mesh(new THREE.BoxGeometry(COURT_W + 4, 1.1, 0.3), wallMat);
    wall.position.set(0, 0.55, -COURT_H / 2 - 2.2);
    this.scene.add(wall);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, COURT_H + 5), wallMat);
      side.position.set(sx * (COURT_W / 2 + 2), 0.4, 0.8);
      this.scene.add(side);
    }
    const postMat = lam('#2b2238');
    for (let i = 0; i <= 8; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), postMat);
      post.position.set(-COURT_W / 2 - 2 + (i * (COURT_W + 4)) / 8, 2.1, -COURT_H / 2 - 2.2);
      this.scene.add(post);
    }
    const fence = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W + 4, 2.4), new THREE.MeshBasicMaterial({ color: '#c9b6e4', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    fence.position.set(0, 2.3, -COURT_H / 2 - 2.2);
    this.scene.add(fence);

    // City blocks and trees, deterministic layout.
    const bcols = ['#5c3d7a', '#7b4b8f', '#45325e', '#8e5a86', '#3e2f5b'];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 16; i++) {
      const wdt = 3 + rnd() * 4, hgt = 4 + rnd() * 10;
      const b = new THREE.Mesh(new THREE.BoxGeometry(wdt, hgt, 3 + rnd() * 3), lam(bcols[i % bcols.length]));
      const a = -Math.PI * 0.95 + (i / 15) * Math.PI * 0.9;
      const r = 24 + rnd() * 8;
      b.position.set(Math.cos(a) * r, hgt / 2, Math.sin(a) * r * 0.8 - 6);
      b.lookAt(0, hgt / 2, 0);
      this.scene.add(b);
      // Lit windows.
      if (i % 2 === 0) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(wdt * 0.6, hgt * 0.5), new THREE.MeshBasicMaterial({ color: '#ffd38a', transparent: true, opacity: 0.35 }));
        win.position.copy(b.position).add(new THREE.Vector3(0, hgt * 0.1, 0));
        win.lookAt(0, win.position.y, 0);
        win.translateZ(2.2);
        this.scene.add(win);
      }
    }
    const leaf = lam('#2d8a5f'), leaf2 = lam('#3fa36d'), trunk = lam('#6b4b3a');
    const treeSpots: [number, number][] = [[-11, -8], [11, -8.5], [-12, -2], [12.5, -1], [-12, 5], [12, 6], [-9.5, 10], [9.5, 10.5]];
    for (const [x, z] of treeSpots) {
      const t = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.4, 5), trunk);
      tr.position.y = 0.7;
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 6), leaf);
      c1.position.y = 2.1;
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 6), leaf2);
      c2.position.y = 3.0;
      t.add(tr, c1, c2);
      t.position.set(x, 0, z);
      this.scene.add(t);
    }
  }

  private buildCourt() {
    const S = 64; // px per meter
    const c = document.createElement('canvas');
    c.width = COURT_W * S; c.height = COURT_H * S;
    const g = c.getContext('2d')!;
    // Planks.
    for (let i = 0; i < COURT_W * 4; i++) {
      g.fillStyle = i % 2 ? '#e0a56a' : '#d99c60';
      g.fillRect((i * S) / 4, 0, S / 4 + 1, c.height);
    }
    g.fillStyle = 'rgba(120,60,20,0.08)';
    for (let i = 0; i < 60; i++) g.fillRect(((i * 37) % COURT_W) * S, ((i * 53) % COURT_H) * S, S / 4, S * 1.5);
    const X = (x: number) => x * S, Y = (y: number) => y * S;
    // Two-point zone tint.
    g.fillStyle = 'rgba(70,40,120,0.16)';
    g.fillRect(0, 0, c.width, c.height);
    g.save();
    g.beginPath();
    const cornerY = HOOP.y + Math.sqrt(ARC_R * ARC_R - CORNER_DX * CORNER_DX);
    g.moveTo(X(HOOP.x - CORNER_DX), 0);
    g.lineTo(X(HOOP.x - CORNER_DX), Y(cornerY));
    const a0 = Math.atan2(cornerY - HOOP.y, -CORNER_DX);
    const a1 = Math.atan2(cornerY - HOOP.y, CORNER_DX);
    g.arc(X(HOOP.x), Y(HOOP.y), ARC_R * S, a0, a1, true);
    g.lineTo(X(HOOP.x + CORNER_DX), 0);
    g.closePath();
    g.fillStyle = '#e8b07a';
    g.fill();
    g.restore();
    // Paint.
    g.fillStyle = '#2b4c9b';
    g.fillRect(X(HOOP.x - 2.45), 0, 4.9 * S, 5.8 * S);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 0.07 * S;
    g.strokeRect(X(HOOP.x - 2.45), 0, 4.9 * S, 5.8 * S);
    g.beginPath();
    g.arc(X(HOOP.x), Y(5.8), 1.8 * S, 0, Math.PI);
    g.stroke();
    g.beginPath();
    g.arc(X(HOOP.x), Y(HOOP.y), 1.25 * S, 0, Math.PI);
    g.stroke();
    // Arc.
    g.beginPath();
    g.moveTo(X(HOOP.x - CORNER_DX), 0);
    g.lineTo(X(HOOP.x - CORNER_DX), Y(cornerY));
    g.arc(X(HOOP.x), Y(HOOP.y), ARC_R * S, a0, a1, true);
    g.lineTo(X(HOOP.x + CORNER_DX), 0);
    g.stroke();
    // Border + top line.
    g.lineWidth = 0.1 * S;
    g.strokeRect(0, 0, c.width, c.height);
    // Center logo: a ring.
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 0.06 * S;
    g.beginPath();
    g.arc(X(HOOP.x), Y(COURT_H), 1.8 * S, Math.PI, 0);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, COURT_H), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
  }

  private buildHoop() {
    const lam = (c: string) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const g = new THREE.Group();
    const baseZ = -COURT_H / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.6, 8), lam('#30303c'));
    pole.position.set(0, 1.8, baseZ - 0.9);
    const padBase = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), lam('#ff7a1a'));
    padBase.position.set(0, 0.25, baseZ - 0.9);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.1), lam('#30303c'));
    arm.position.set(0, 3.45, baseZ + 0.1);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.06), new THREE.MeshLambertMaterial({ color: '#f4f7ff', transparent: true, opacity: 0.92 }));
    board.position.set(0, 3.5, baseZ + 1.2);
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.59, 0.45), new THREE.MeshBasicMaterial({ color: '#ff4d2e' }));
    sq.position.set(0, 3.3, baseZ + 1.235);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.37), new THREE.MeshBasicMaterial({ color: '#f4f7ff' }));
    inner.position.set(0, 3.3, baseZ + 1.237);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.86, 1.1, 0.04), lam('#ff4d2e'));
    frame.position.set(0, 3.5, baseZ + 1.17);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.025, 6, 22), lam('#ff5a1f'));
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(RIM);
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.15, 0.45, 12, 3, true),
      new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.85 }),
    );
    net.position.set(RIM.x, RIM_H - 0.24, RIM.z);
    g.add(pole, padBase, arm, frame, board, sq, inner, rim, net);
    this.scene.add(g);
    return { net, rim };
  }

  private ballTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f2711c';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#2a1408';
    g.lineWidth = 5;
    for (const x of [0, 64, 128, 192, 256]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---------------- per-frame sync ----------------
  setPlayer(i: number, s: PoseState, dt: number) { this.players[i].update(s, dt); }

  setBall(p: THREE.Vector3, spin: number) {
    this.ball.position.copy(p);
    this.ball.rotation.x += spin;
  }

  setHandler(pos: THREE.Vector3 | null) {
    this.handlerMarker.visible = !!pos;
    if (pos) {
      this.handlerMarker.position.set(pos.x, 0, pos.z);
      const gem = this.handlerMarker.getObjectByName('gem')!;
      gem.position.y = 2.75 + Math.sin(this.time * 5) * 0.08 + pos.y;
      gem.rotation.y += 0.04;
      const s = 1 + Math.sin(this.time * 6) * 0.06;
      this.handlerMarker.children[0].scale.setScalar(s);
    }
  }

  setControlled(pos: THREE.Vector3 | null) {
    this.controlMarker.visible = !!pos;
    if (pos) this.controlMarker.position.set(pos.x, 2.6 + pos.y + Math.sin(this.time * 5) * 0.06, pos.z);
  }

  setMoveTarget(p: THREE.Vector3 | null) {
    this.targetMarker.visible = !!p;
    if (p) {
      this.targetMarker.position.set(p.x, 0.03, p.z);
      this.targetMarker.scale.setScalar(1 + Math.sin(this.time * 8) * 0.12);
    }
  }

  kickNet() { this.netKick = 1; }
  kickRim() { this.rimKick = 1; }

  // ---------------- camera ----------------
  /**
   * Frame a set of points from a horizontal viewing direction and pitch.
   * `dir` points from the camera toward the scene. `side` shifts the camera sideways (third-person shoulder).
   */
  frame(points: THREE.Vector3[], dir: THREE.Vector3, pitchDeg: number, minR: number, opts: { side?: number; lookBias?: THREE.Vector3; speed?: number; zoom?: number } = {}) {
    const c = new THREE.Vector3();
    for (const p of points) c.add(p);
    c.divideScalar(points.length || 1);
    let r = minR;
    for (const p of points) r = Math.max(r, p.distanceTo(c));
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const half = Math.min(vHalf, hHalf);
    const dist = (r / Math.sin(half)) * (opts.zoom ?? 1);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const d = dir.clone().setY(0).normalize();
    const right = new THREE.Vector3(-d.z, 0, d.x);
    const look = c.clone();
    if (opts.lookBias) look.add(opts.lookBias);
    this.wantLook.copy(look);
    this.wantPos.copy(look)
      .addScaledVector(d, -Math.cos(pitch) * dist)
      .addScaledVector(right, opts.side ?? 0)
      .setY(look.y + Math.sin(pitch) * dist);
    this.camSpeed = opts.speed ?? 3;
  }

  snapCamera() {
    this.camPos.copy(this.wantPos);
    this.camLook.copy(this.wantLook);
  }

  // ---------------- previews & labels ----------------
  clearPreview() {
    for (const o of [...this.preview.children]) {
      this.preview.remove(o);
      o.traverse((x) => {
        if (x instanceof CSS2DObject) x.element.remove();
        const m = x as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.dotPaths = [];
    this.pulses = [];
  }

  dots(curve: THREE.Curve<THREE.Vector3>, color: string, radius = 0.07, spacing = 0.32, speed = 0.9) {
    const dp = new DotPath(curve, color, radius, spacing, speed);
    this.dotPaths.push(dp);
    this.preview.add(dp.mesh);
    return dp;
  }

  ghostBall(p: THREE.Vector3, color = '#ffffff') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    m.position.copy(p);
    this.preview.add(m);
    return m;
  }

  floorRing(p: THREE.Vector3, color: string, r = 0.75, pulse = true) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.78, r, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.04, p.z);
    this.preview.add(m);
    if (pulse) this.pulses.push(m);
    return m;
  }

  dome(p: THREE.Vector3, color: string, r = 1.05) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(p.x, 0, p.z);
    const wire = new THREE.Mesh(m.geometry.clone(), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.35 }));
    m.add(wire);
    this.preview.add(m);
    return m;
  }

  wall(a: THREE.Vector3, facing: THREE.Vector3, color: string, wdt = 1.3, hgt = 1.6, baseH = 1.8) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wdt, hgt), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(a.x, baseH + hgt / 2, a.z);
    m.lookAt(a.x + facing.x, baseH + hgt / 2, a.z + facing.z);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color }));
    m.add(edge);
    this.preview.add(m);
    return m;
  }

  sector(p: THREE.Vector3, dirAngle: number, spread: number, r: number, color: string) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24, 0, spread), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = dirAngle - spread / 2;
    m.position.set(p.x, 0.035, p.z);
    this.preview.add(m);
    return m;
  }

  label(spec: LabelSpec) {
    const el = document.createElement('div');
    el.className = `wlabel ${spec.cls ?? ''}`;
    el.innerHTML = spec.html;
    const o = new CSS2DObject(el);
    o.position.copy(spec.pos);
    this.preview.add(o);
    return o;
  }

  /** Floating callout that rises and fades (e.g. "+2", "BLOCK"). */
  callout(pos: THREE.Vector3, html: string, cls = '') {
    const el = document.createElement('div');
    el.className = `callout ${cls}`;
    el.innerHTML = html;
    const o = new CSS2DObject(el);
    o.position.copy(pos);
    this.scene.add(o);
    this.floaters.push({ obj: o, t: 0, base: pos.clone() });
  }

  // ---------------- picking ----------------
  private ray = new THREE.Raycaster();
  pickCourt(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x + COURT_W / 2, y: hit.z + COURT_H / 2 };
  }

  render(dt: number) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * this.camSpeed);
    this.camPos.lerp(this.wantPos, k);
    this.camLook.lerp(this.wantLook, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.25;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0));
    }
    this.camera.lookAt(this.camLook);

    for (const dp of this.dotPaths) dp.update(dt);
    for (const p of this.pulses) p.scale.setScalar(1 + Math.sin(this.time * 6) * 0.08);

    this.netKick = Math.max(0, this.netKick - dt * 2.5);
    this.net.scale.set(1 - this.netKick * 0.25, 1 + this.netKick * 0.35, 1 - this.netKick * 0.25);
    this.rimKick = Math.max(0, this.rimKick - dt * 4);
    this.rim.position.y = RIM_H + Math.sin(this.time * 60) * 0.02 * this.rimKick;

    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      f.obj.position.copy(f.base).add(new THREE.Vector3(0, f.t * 0.8, 0));
      f.obj.element.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.9) / 0.5));
      if (f.t > 1.4) { this.scene.remove(f.obj); f.obj.element.remove(); return false; }
      return true;
    });

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
