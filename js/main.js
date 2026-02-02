// Wait for THREE.js to be loaded from the module script before initializing
window.addEventListener('three-ready', initApp);

function initApp() {
  const beats = document.querySelectorAll(".beat");
  const panelText = document.getElementById("panel-text");
  const preloader = document.getElementById("preloader");
  const stage = document.getElementById("stage");
  const particlesCanvas = document.getElementById("particles");
  const particlesCtx = particlesCanvas.getContext("2d");
  const thumpSound = document.getElementById("thump-sound");
  const waveSound = document.getElementById("wave-sound");
  const explosionSound = document.getElementById("explosion-sound");

  particlesCanvas.width = stage.offsetWidth;
  particlesCanvas.height = stage.offsetHeight;

// Web Audio API setup
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioBuffers = {};
const sources = {};

// Ensure AudioContext will be resumed after a user gesture (fixes autoplay restriction)
if (audioCtx && audioCtx.state === 'suspended') {
  const resumeOnGesture = () => {
    audioCtx.resume().then(() => {
      // console.info('AudioContext resumed after user gesture');
    }).catch(() => {});
    window.removeEventListener('pointerdown', resumeOnGesture);
    window.removeEventListener('keydown', resumeOnGesture);
  };
  window.addEventListener('pointerdown', resumeOnGesture, { once: true });
  window.addEventListener('keydown', resumeOnGesture, { once: true });
}

// Preload audio
async function preloadAudio() {
  const audioFiles = Array.from(beats).map(beat => beat.dataset.audio);
  audioFiles.push("assets/audio/hover-beep.mp3");
  // background music removed per user request; do not preload intro.wav

  const promises = audioFiles.map(async (src) => {
    const response = await fetch(src);
    const arrayBuffer = await response.arrayBuffer();
    audioBuffers[src] = await audioCtx.decodeAudioData(arrayBuffer);
  });

  await Promise.all(promises);
  return new Promise(resolve => {
    gsap.to(preloader, { opacity: 0, duration: 1, onComplete: () => {
      preloader.style.display = "none";
      initThreeJS();
      resolve();
    }});
  });
}

// Three.js setup for true 3D speaker
let scene, camera, renderer, speakerGroup, particlesSystem;
let speakerShadow; // circular shadow under the speaker (pulses like a shadow)
let waveRings = [];
let exploded = false;
let explosionParticles = []; // physics-driven explosion pieces
const clock = new THREE.Clock();
    
  // Interactive menu variables
  let menuGroup = null;
  let raycaster = new THREE.Raycaster();
  let mouse = new THREE.Vector2();
  let menuItems = []; // store menu meshes + target URLs
  let centerModels = []; // store center 3D model(s) for special click behavior
  let isDraggingMenu = false;
  let lastPointerX = 0;

function initThreeJS() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, stage.offsetWidth / stage.offsetHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("three-canvas"), alpha: true });
  renderer.setSize(stage.offsetWidth, stage.offsetHeight);

  // Simple 3D speaker model (black body, red accents)
  speakerGroup = new THREE.Group();
  // Make the whole speaker a bit smaller so it fits better on screen
  speakerGroup.scale.set(0.8, 0.8, 0.8);

  // Add simple lighting to make materials readable
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5, 5, 5);
  scene.add(dir);
  const frontPoint = new THREE.PointLight(0xffdddd, 0.4, 10);
  frontPoint.position.set(0, 0, 3);
  scene.add(frontPoint);

  // Body (larger speaker box)
  const bodyGeometry = new THREE.BoxGeometry(3, 3, 1.2);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, metalness: 0.25, roughness: 0.55 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  speakerGroup.add(body);

  // Front panel (slightly inset circle to act as the speaker face)
  // Increase radius to match the larger box and use a neutral grey color
  const faceGeometry = new THREE.CircleGeometry(1.35, 64);
  const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x6e6e6e, metalness: 0.05, roughness: 0.7 });
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.z = 0.61; // Just in front of the box face (half depth + small offset)
  speakerGroup.add(face);

  // Outer surround (rubber ring) - sized to match the larger face
  const surroundGeometry = new THREE.TorusGeometry(1.28, 0.14, 16, 100);
  const surroundMaterial = new THREE.MeshStandardMaterial({ color: 0x070707, metalness: 0.05, roughness: 0.8 });
  const surround = new THREE.Mesh(surroundGeometry, surroundMaterial);
  // Keep the surround facing forward (no rotation) so it matches the face
  surround.rotation.x = 0;
  surround.position.z = 0.95;
  speakerGroup.add(surround);

  // Cone (a smoother cone with subtle material) - sized for the larger speaker and grey
  const coneGeometry = new THREE.CylinderGeometry(0.0, 1.05, 0.6, 64); // wider base
  const coneMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.02, roughness: 0.6 });
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  cone.rotation.x = Math.PI / 2; // point along Z
  cone.position.z = 1.02; // sit within the surround
  speakerGroup.add(cone);

  // Dust cap (small convex cap in the center)
  const capGeometry = new THREE.SphereGeometry(0.22, 32, 16);
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.2, roughness: 0.35 });
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.position.z = 1.12; // slightly in front of cone center
  speakerGroup.add(cap);

  // Grille ring (subtle metallic ring) - ensure it faces forward and fits the cone
  const ringGeometry = new THREE.RingGeometry(0.65, 0.85, 64);
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  // Make sure the ring faces forward (no X rotation) so it sits vertically on the speaker face
  ring.rotation.x = 0;
  ring.position.z = 1.05;
  speakerGroup.add(ring);

  // Stands (improved cylinders with red accent)
  const standGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.25, 16);
  const standMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, metalness: 0.4, roughness: 0.3 });
  const leftStand = new THREE.Mesh(standGeometry, standMaterial);
  leftStand.position.set(-0.8, -1.05, 0);
  leftStand.rotation.x = 0;
  speakerGroup.add(leftStand);
  const rightStand = new THREE.Mesh(standGeometry, standMaterial);
  rightStand.position.set(0.8, -1.05, 0);
  speakerGroup.add(rightStand);

  scene.add(speakerGroup);

  // subtle circular shadow underneath the speaker (will pulse)
  const shadowGeo = new THREE.CircleGeometry(1.3, 32);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 });
  speakerShadow = new THREE.Mesh(shadowGeo, shadowMat);
  speakerShadow.rotation.x = -Math.PI / 2;
  // place just below the speaker bottom (box half-height is 1.5)
  speakerShadow.position.set(0, -1.62, 0.0);
  speakerShadow.scale.set(1,1,1);
  speakerGroup.add(speakerShadow);

  // Position camera
  camera.position.z = 5;

  // Start intro animation or skip it if requested via URL
  const urlParams = new URLSearchParams(window.location.search);
  const skipIntro = urlParams.get('skipIntro') === '1' || urlParams.get('fastmenu') === '1';

  if (skipIntro) {
    // Immediately reveal the interactive menu without the speaker fall or explosion
    // Hide speaker visuals and run menu build
    speakerGroup.visible = false;
    // Ensure any legacy UI is hidden and then build the menu
    revealMenu();
    createInteractiveMenu();
  } else {
    // Start intro animation
    speakerGroup.position.y = 10; // Start off-screen top
    speakerGroup.rotation.y = Math.PI / 4; // Side view (45 degrees)
    animateSpeakerFall();
  }
}

function animateSpeakerFall() {
  gsap.to(speakerGroup.position, {
    y: 0,
    duration: 2,
    ease: "bounce.out",
    onUpdate: () => {
      speakerGroup.rotation.x = Math.random() * 0.1 - 0.05; // 3D wobble
      speakerGroup.rotation.z = Math.random() * 0.1 - 0.05;
    },
    onComplete: () => {
      thumpSound.play().catch(() => {});
      startSpeakerWaves();
      // Start a slow continuous spin once the speaker is settled in the middle
      gsap.to(speakerGroup.rotation, {
        y: "+=" + (Math.PI * 2),
        duration: 6,
        repeat: -1,
        ease: "linear"
      });
    }
  });
}

function startSpeakerWaves() {
  waveSound.play().catch(() => {});

  // 3D wave rings
  const waveInterval = setInterval(() => {
    if (exploded) clearInterval(waveInterval);
  const ringGeometry = new THREE.RingGeometry(1, 1.5, 32);
  // Make the wave rings black and subtle instead of red
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.z = 1; // In front of speaker
    ring.scale.set(0.2, 0.2, 0.2);
    scene.add(ring);
    waveRings.push(ring);

    gsap.to(ring.scale, {
      x: 3,
      y: 3,
      z: 3,
      duration: 1.5,
      ease: "sine.out",
      onUpdate: () => { ring.material.opacity -= 0.01; },
      onComplete: () => {
        scene.remove(ring);
        waveRings = waveRings.filter(r => r !== ring);
      }
    });
  }, 500);

  // Pulse speaker
  // Pulse the circular shadow under the speaker to act like a breathing shadow
  if (speakerShadow) {
    gsap.to(speakerShadow.scale, {
      x: 1.12,
      y: 1.12,
      z: 1.12,
      duration: 0.5,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });
  }

  // Click listener on canvas
  document.getElementById("three-canvas").addEventListener("click", explodeSpeaker, { once: true });
}

function explodeSpeaker() {
  if (exploded) return;
  exploded = true;
  waveSound.pause();
  explosionSound.play().catch(() => {});

  // brief flash light to emphasize explosion (fades quickly)
  const flash = new THREE.PointLight(0xffeecc, 2.5, 10);
  flash.position.copy(speakerGroup.position).add(new THREE.Vector3(0, 0, 1));
  scene.add(flash);
  gsap.to(flash, { intensity: 0, duration: 0.8, ease: "power2.out", onComplete: () => scene.remove(flash) });

  // Create debris pieces (boxes) and smoke puffs (spheres)
  const debrisCount = 80; // moderate amount to avoid saturating the page
  for (let i = 0; i < debrisCount; i++) {
    const size = Math.random() * 0.18 + 0.05;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.2, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    // start near the speaker center with small random offset
    mesh.position.set(
      speakerGroup.position.x + (Math.random() - 0.5) * 0.6,
      speakerGroup.position.y + (Math.random() - 0.5) * 0.6,
      speakerGroup.position.z + (Math.random() - 0.5) * 0.6
    );
    scene.add(mesh);

    const speed = 2 + Math.random() * 6;
    const dir = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.2), (Math.random() - 0.5)).normalize();
    const velocity = dir.multiplyScalar(speed);

    explosionParticles.push({
      mesh,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      rotx: Math.random() * 4 - 2,
      roty: Math.random() * 4 - 2,
      rotz: Math.random() * 4 - 2,
      lifetime: 2.5 + Math.random() * 1.5,
      age: 0,
      type: 'debris'
    });
  }

  // smoke puffs
  const smokeCount = 18;
  for (let i = 0; i < smokeCount; i++) {
    const r = Math.random() * 0.6 + 0.4;
    const geo = new THREE.SphereGeometry(r, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x333333, transparent: true, opacity: 0.55, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      speakerGroup.position.x + (Math.random() - 0.5) * 0.4,
      speakerGroup.position.y + (Math.random() - 0.5) * 0.4,
      speakerGroup.position.z + (Math.random() - 0.5) * 0.4
    );
    scene.add(mesh);
    explosionParticles.push({
      mesh,
      vx: (Math.random() - 0.5) * 0.8,
      vy: Math.random() * 1.2 + 0.2,
      vz: (Math.random() - 0.5) * 0.8,
      rotx: 0,
      roty: 0,
      rotz: 0,
      lifetime: 3.0 + Math.random() * 1.5,
      age: 0,
      type: 'smoke',
      startScale: r
    });
  }

  // small glowing embers
  const emberCount = 30;
  for (let i = 0; i < emberCount; i++) {
    const geo = new THREE.SphereGeometry(0.04, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(speakerGroup.position);
    scene.add(mesh);
    explosionParticles.push({
      mesh,
      vx: (Math.random() - 0.5) * 5,
      vy: Math.random() * 6,
      vz: (Math.random() - 0.5) * 5,
      rotx: 0,
      roty: 0,
      rotz: 0,
      lifetime: 1.2 + Math.random() * 0.6,
      age: 0,
      type: 'ember'
    });
  }

  // remove speaker mesh to reveal explosion
  scene.remove(speakerGroup);

  // Reveal menu after explosion clears
  const totalCleanup = 3000;
  setTimeout(() => {
    // Instead of hiding the three.js canvas, build an interactive 3D menu in the same scene
    revealMenu();
    createInteractiveMenu();
  }, totalCleanup);
}

function revealMenu() {
  // Hide legacy beat DOM elements and panel; we'll show an interactive 3D menu instead
  beats.forEach(b => { b.style.pointerEvents = 'none'; b.style.opacity = '0'; b.style.display = 'none'; });
  const panelEl = document.getElementById("panel");
  if (panelEl) { panelEl.style.pointerEvents = 'none'; panelEl.style.opacity = '0'; }
}

// Create an interactive 3D menu with 4 sections (About, Beats, Releases, Contact)
function createInteractiveMenu() {
  if (menuGroup) return; // already created

  menuGroup = new THREE.Group();
  // reset interactive lists to avoid duplicates on re-entry
  menuItems = [];
  centerModels = [];

  // Build menu items from existing <nav class="nav"> links in the page instead
  // of a hard-coded menu variable. This keeps the site DRY and editable in HTML.
  let sections = [];
  try {
    const navLinks = document.querySelectorAll('.nav a');
    navLinks.forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href === '#' || href === 'index.html') return; // skip home or anchors
      const title = a.textContent.trim().toUpperCase();
      let type = 'person';
      if (/beat|audio|beats/i.test(title)) type = 'mp3';
      else if (/release|archive|vinyl/i.test(title)) type = 'vinyl';
      else if (/contact|transmission/i.test(title)) type = 'envelope';
      sections.push({ title, url: href, type });
    });
  } catch (e) {
    // fallback: if nav not found, use a sensible default
    sections = [];
  }

  // Ensure there are exactly 4 menu slots (pad with defaults if necessary)
  const defaults = [
    { title: 'ABOUT', url: 'about.html', type: 'person' },
    { title: 'BEATS', url: 'beats.html', type: 'mp3' },
    { title: 'RELEASES', url: 'releases.html', type: 'vinyl' },
    { title: 'CONTACT', url: 'contact.html', type: 'envelope' }
  ];
  sections = sections.slice(0,4);
  for (let i = sections.length; i < 4; i++) sections.push(defaults[i]);

  // Layout: two on left, two on right (vertical stack) — make larger and spread out more, positioned higher
  const leftX = -2.5;
  const rightX = 2.5;
  const topY = 2.0;
  const bottomY = -0.6;
  const z = 1.15;
  const w = 1.6, h = 1.1, depth = 0.18;

  const positions = [ {x:leftX, y:topY}, {x:rightX, y:topY}, {x:leftX, y:bottomY}, {x:rightX, y:bottomY} ];

  sections.forEach((s, i) => {
    const pos = positions[i];
    const canvas = makeIconCanvas(s.title, s.type);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
    const geo = new THREE.BoxGeometry(w, h, depth);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, z);
    mesh.userData = { url: s.url, title: s.title };
    // slight tilt toward camera
    mesh.rotation.x = -0.05;
    menuGroup.add(mesh);
    menuItems.push(mesh);
  // make each menu box slowly spin around its Y axis (in sync)
  gsap.to(mesh.rotation, { y: "+=" + (Math.PI * 2), duration: 6, repeat: -1, ease: 'linear' });
  });

  // Add a circle shadow below the menu boxes
  const shadowGeo = new THREE.CircleGeometry(1.2, 64);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 });
  const menuShadow = new THREE.Mesh(shadowGeo, shadowMat);
  menuShadow.rotation.x = -Math.PI / 2;
  menuShadow.position.set(0, -2.5, 0);
  menuGroup.add(menuShadow);

  // load a 3D model from assets/3d to replace the inline person model
  // The model file should be placed at: assets/3d/person.gltf (or .glb)
  // Try to load the model using the global (non-module) GLTFLoader if available.
  // This avoids creating multiple Three.js instances and keeps the existing global THREE usage.
  const tryLoadPersonModel = () => {
    // Load provided GLB and normalize its transform so it sits centered in the menu.
    if (typeof window.GLTFLoader === 'undefined') {
      console.warn('GLTFLoader not available — cannot load 3D model.');
      return;
    }

    const loader = new window.GLTFLoader();
    const tryGlb = 'assets/3d/soul_eater_moon.glb';
    const tryGltf = 'assets/3d/scene.gltf';

    const placeModel = (model) => {
      // compute bbox, center, and scale to fit nicely in the menu center
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      // make the model even bigger (3.0 instead of 2.0)
      const desired = 3.0;
      const s = maxDim > 0 ? (desired / maxDim) : 1.0;
      model.scale.set(s, s, s);

      // recalc bbox and center after scaling
      box.setFromObject(model);
      const center = new THREE.Vector3();
      box.getCenter(center);
      // move model so its center is at origin, then position it closer to camera and centered vertically
      model.position.sub(center);
      model.position.y += 0;  // center vertically in the menu
      model.position.z += 2.5;

      // rotate to face camera properly
      model.rotation.y = 0;
      // mark model and its children so clicks on it can be detected
      model.userData = model.userData || {};
      model.userData.centerModel = true;
      model.traverse((c) => { if (c.isMesh) { c.userData = c.userData || {}; c.userData.centerModel = true; } });
      centerModels.push(model);

      menuGroup.add(model);
    };

    loader.load(tryGlb, (gltf) => {
      const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!model) {
        console.warn('Loaded GLB but no scene was found.');
        return;
      }
      placeModel(model);
    }, undefined, (err) => {
      console.warn('Failed to load', tryGlb, err);
      // try glTF fallback (scene.gltf which uses scene.bin and textures)
      loader.load(tryGltf, (gltf2) => {
        const model2 = gltf2.scene || (gltf2.scenes && gltf2.scenes[0]);
        if (!model2) { console.warn('Loaded fallback glTF but no scene found.'); return; }
        placeModel(model2);
      }, undefined, (err2) => {
        console.warn('Failed to load fallback glTF as well:', err2);
      });
    });
  };

  tryLoadPersonModel();

  menuGroup.position.y = -0.2;
  scene.add(menuGroup);

  // entrance animation (grow) — slightly smaller overall
  menuGroup.scale.set(0.1,0.1,0.1);
  gsap.to(menuGroup.scale, { x:0.95, y:0.95, z:0.95, duration:0.7, ease: 'back.out(1.2)' });

  // pointer interactions for hover & click
  const canvasEl = renderer.domElement;
  canvasEl.style.pointerEvents = 'auto';
  canvasEl.addEventListener('pointermove', (e) => {
    const rect = canvasEl.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  });
  canvasEl.addEventListener('click', (e) => {
    const rect = canvasEl.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // Check clicks against menu boxes first, then the center model(s)
    const clickable = menuItems.concat(centerModels);
    const hits = raycaster.intersectObjects(clickable, true);
    if (hits.length) {
      const hit = hits[0].object;
      // if it's a menu box with a url, navigate there with the usual animation
      if (hit.userData && hit.userData.url) {
        const target = hit.userData.url;
        gsap.to(hits[0].object.scale, { x:1.12, y:1.12, z:1.12, duration:0.12, yoyo:true, repeat:1, onComplete: () => { window.location.href = target; } });
        return;
      }
      // if it's the center 3D model (or a child), reset to index WITHOUT skipping intro
      if (hit.userData && hit.userData.centerModel) {
        // small feedback: pulse the whole menuGroup then navigate to index normally
        gsap.to(menuGroup.scale, { x:0.85, y:0.85, z:0.85, duration:0.12, yoyo:true, repeat:1, onComplete: () => { window.location.href = 'index.html'; } });
        return;
      }
    }
  });

  // (Hover focus and center image removed — replaced by center 3D person)
}

function makeMenuCanvas(text) {
  const w = 512, h = 320;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // background
  ctx.fillStyle = '#111';
  ctx.fillRect(0,0,w,h);
  // title
  ctx.fillStyle = '#ddd';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w/2, h/2+10);
  // subtle border
  ctx.strokeStyle = '#333'; ctx.lineWidth = 8; ctx.strokeRect(8,8,w-16,h-16);
  return c;
}

function makeIconCanvas(text, type) {
  const w = 512, h = 384;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // background
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0,0,w,h);

  // draw icon depending on type
  ctx.fillStyle = '#e6e6e6';
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 8;

  if (type === 'mp3') {
    // draw file shape
    ctx.fillStyle = '#222';
    ctx.fillRect(120, 60, 272, 272);
    // folded corner
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath(); ctx.moveTo(360,60); ctx.lineTo(360,120); ctx.lineTo(300,60); ctx.closePath(); ctx.fill();
    // music note
    ctx.fillStyle = '#f0f0f0';
    ctx.beginPath(); ctx.arc(260,200,28,0,Math.PI*2); ctx.fill();
    ctx.fillRect(280,170,18,90); ctx.fillRect(298,170,8,8);
  } else if (type === 'person') {
    // head
    ctx.beginPath(); ctx.fillStyle = '#f0f0f0'; ctx.arc(256,150,38,0,Math.PI*2); ctx.fill();
    // body
    ctx.beginPath(); ctx.fillRect(210,210,92,120);
  } else if (type === 'vinyl') {
    // vinyl disc
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(256,200,80,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#777'; ctx.beginPath(); ctx.arc(256,200,24,0,Math.PI*2); ctx.fill();
  } else if (type === 'envelope') {
    ctx.fillStyle = '#222'; ctx.fillRect(120,120,272,160);
    ctx.strokeStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(120,120); ctx.lineTo(256,220); ctx.lineTo(392,120); ctx.stroke();
  }

  // title text
  ctx.fillStyle = '#ddd'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, w/2, h - 40);
  return c;
}

// Three.js render loop (with explosion particle updates)
function animateThree() {
  requestAnimationFrame(animateThree);

  const dt = Math.min(clock.getDelta(), 0.05); // clamp delta for stability

  if (exploded && explosionParticles.length > 0) {
    for (let i = explosionParticles.length - 1; i >= 0; i--) {
      const p = explosionParticles[i];
      p.age += dt;

      // simple physics
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      // gravity on debris and embers
      if (p.type === 'debris' || p.type === 'ember') p.vy -= 9.8 * dt * 0.6;
      // gentle rise for smoke
      if (p.type === 'smoke') p.vy += 0.4 * dt;

      // rotation
      p.mesh.rotation.x += (p.rotx || 0) * dt;
      p.mesh.rotation.y += (p.roty || 0) * dt;
      p.mesh.rotation.z += (p.rotz || 0) * dt;

      // fade/scale over lifetime
      const lifeRatio = p.age / p.lifetime;
      if (p.type === 'smoke') {
        p.mesh.material.opacity = Math.max(0, 0.55 * (1 - lifeRatio));
        const s = p.startScale * (1 + lifeRatio * 1.8);
        p.mesh.scale.set(s, s, s);
      } else if (p.type === 'ember') {
        p.mesh.material.opacity = Math.max(0, 0.9 * (1 - lifeRatio));
      } else {
        // debris
        p.mesh.material.opacity = p.mesh.material.transparent ? Math.max(0, 1 - lifeRatio) : 1;
        const scale = Math.max(0, 1 - lifeRatio);
        p.mesh.scale.set(scale, scale, scale);
      }

      if (p.age >= p.lifetime) {
        scene.remove(p.mesh);
        explosionParticles.splice(i, 1);
      }
    }
  }

  // menu is static now; hover effects removed per request

  // renderer may not be initialized yet (initThreeJS runs after preloadAudio completes).
  // Guard the render call to avoid "Cannot read properties of undefined (reading 'render')".
  if (typeof renderer !== 'undefined' && renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// (Removed floating background orbs to reduce visual noise)

// Floating motion for beats
beats.forEach(beat => {
  gsap.to(beat, {
    y: "+=20",
    duration: 2 + Math.random() * 3,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut"
  });
  gsap.to(beat, {
    rotation: Math.random() * 10 - 5,
    duration: 3 + Math.random() * 3,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut"
  });
});

// Draggable with physics/collisions
Draggable.create(".beat", {
  type: "x,y",
  bounds: "#stage",
  inertia: true,
  snap: {
    x: function(value) { return Math.round(value / 10) * 10; }, // Snap to grid for fun
    y: function(value) { return Math.round(value / 10) * 10; }
  },
  onThrowUpdate: checkCollisions
});

// Simple collision detection (bouncy)
function checkCollisions() {
  beats.forEach((beat1, i) => {
    beats.forEach((beat2, j) => {
      if (i !== j) {
        const rect1 = beat1.getBoundingClientRect();
        const rect2 = beat2.getBoundingClientRect();
        if (rect1.left < rect2.right && rect1.right > rect2.left && rect1.top < rect2.bottom && rect1.bottom > rect2.top) {
          // Bounce apart
          gsap.to(beat1, { x: "+=20", duration: 0.5, ease: "bounce.out" });
          gsap.to(beat2, { x: "-=20", duration: 0.5, ease: "bounce.out" });
        }
      }
    });
  });
}

// Hover feedback
beats.forEach(beat => {
  beat.addEventListener("mouseenter", () => {
    panelText.textContent = "READY: " + beat.querySelector(".beat-label").textContent;
    gsap.to(beat, { scale: 1.3, rotation: 10, duration: 0.3 });
    // Hover sound (assume you have a short beep)
    const hoverSource = audioCtx.createBufferSource();
    hoverSource.buffer = audioBuffers["assets/audio/hover-beep.mp3"]; // Add this asset
    hoverSource.connect(audioCtx.destination);
    hoverSource.start();
  });

  beat.addEventListener("mouseleave", () => {
    panelText.textContent = "AUDIO SYSTEM READY";
    gsap.to(beat, { scale: 1, rotation: 0, duration: 0.3 });
  });

  // Click to toggle play/pause with animation and particles
  beat.addEventListener("click", (e) => {
    const src = beat.dataset.audio;
    const label = beat.querySelector(".beat-label").textContent;

    if (sources[src] && !sources[src].stopped) {
      sources[src].stop();
      sources[src].stopped = true;
      beat.classList.remove("playing");
      panelText.textContent = "PAUSED: " + label;
      gsap.killTweensOf(beat.querySelector("svg")); // Stop drumming anim
    } else {
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffers[src];
      source.connect(audioCtx.destination);
      source.loop = true; // For beat looping
      source.start();
      sources[src] = source;
      sources[src].stopped = false;
      beat.classList.add("playing");
      panelText.textContent = "PLAYING: " + label;

      // Drumming animation
      gsap.to(beat.querySelector("svg"), {
        y: "-=5",
        duration: 0.15,
        repeat: -1,
        yoyo: true,
        ease: "bounce.out"
      });

      // Particles burst
      createParticles(e.clientX - stage.getBoundingClientRect().left, e.clientY - stage.getBoundingClientRect().top);
    }
  });
});

// Particle system
const particles = [];
function createParticles(x, y) {
  for (let i = 0; i < 20; i++) {
    particles.push({
      x,
      y,
      vx: Math.random() * 4 - 2,
      vy: Math.random() * 4 - 2,
      radius: Math.random() * 3 + 1,
      alpha: 1
    });
  }
}

function animateParticles() {
  particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
  particles.forEach((p, i) => {
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= 0.02;
    if (p.alpha <= 0) {
      particles.splice(i, 1);
      return;
    }
  particlesCtx.beginPath();
  particlesCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  // Make click particles subtle grey instead of bright red
  particlesCtx.fillStyle = `rgba(60, 60, 60, ${p.alpha})`;
  particlesCtx.fill();
  });
  requestAnimationFrame(animateParticles);
}

preloadAudio();
animateThree();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.offsetWidth, stage.offsetHeight);
});

// Background ambiance starter — create & start when buffers are ready and AudioContext running
// Background music removed: startBackground() has been removed so no ambient loop will play.
} // End of initApp()