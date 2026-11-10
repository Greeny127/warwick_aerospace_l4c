/*
 * ascii.js
 *
 * Two effects that draw coloured text characters ("ASCII") on a <canvas>:
 *
 * 1. AsciiHero: plays a short video and draws it as ASCII. Moving the mouse or a finger over it
 *    leaves a glowing trail of brighter, more saturated characters.
 *
 *      <canvas class="hero__canvas" aria-hidden="true"
 *              data-video="assets/launch.webm assets/launch.mp4"
 *              data-cell-size="18" data-speed="2.5" data-trail-radius="16"></canvas>
 *
 *      data-video          One or more video URLs, separated by spaces. The browser plays the first it supports.
 *      data-cell-size      Font size of each character in px. Bigger = chunkier picture. Default 18.
 *      data-speed          Video playback speed. Default 1.
 *      data-trail-radius   Size of the cursor trail, in characters. Default 16.
 *      data-style          "text" (letters and symbols, the default) or "dots" (a halftone of round dots:
 *                          brighter areas get bigger, brighter dots).
 *
 * 2. AsciiField: a rocket drawn in ASCII, hovering in place with a flickering flame and a drifting
 *    smoke trail. Used as decoration inside page sections.
 *
 *      <canvas class="ascii-field" aria-hidden="true" data-shape="rocket"
 *              data-angle="-30" data-x="0.8" data-y="0.5" data-cell-size="14"></canvas>
 *
 *      data-shape          What to draw. Only "rocket" for now.
 *      data-angle          Rotation in degrees. 0 = flying right, -30 = flying up and to the right.
 *      data-x, data-y      Position of the rocket as a fraction of the canvas (0-1). Default 0.8 and 0.5.
 *      data-size           Length of the rocket as a fraction of the canvas width. Default 0.5.
 *      data-cell-size      Font size of each character in px. Default 14.
 *
 * 3. PageTrail: the same cursor trail, drawn as characters wherever the pointer moves over the page
 *    below the hero. One transparent full-window canvas does it.
 *
 *      <canvas class="ascii-trail" aria-hidden="true" data-page-trail data-cell-size="14"
 *              data-trail-radius="12"></canvas>
 *
 * Colours come from the CSS custom properties --purple-700, --purple-500 and --accent.
 * All canvases are decoration only: keep aria-hidden="true" on them.
 */

// --- Look and feel: tweak these to change the picture -----------------------

const LOOK = {
	gamma: 0.75,        // below 1 brightens dark areas of the video
	gain: 1.35,         // overall brightness of the video before mapping to colour
	floor: 0.3,         // darkest the picture can get (0 = black, 1 = white)
	ceiling: 0.9,       // brightest the picture can get
	dim: 0.9,           // brightness of the characters away from the cursor
	letterBoost: 1.35,  // letters are this much brighter than the block behind them
	blockStrength: 0.7, // brightness of the coloured block behind each letter
	noise: 0.07,        // random shimmer added to every cell
};

const TRAIL = {
	lifetimeMs: 900,        // how long a trail point lives
	updatesPerSecond: 24,   // the trail redraws in visible steps rather than smoothly
	taper: 2.4,             // higher = trail shrinks faster from head to tail
	saturation: 1.1,        // extra colour saturation under the trail
	brightness: 1.12,       // brightness under the trail (1 = normal)
};

const FRAMES_PER_SECOND = 30;
const STILL_FRAME_SECONDS = 4;     // which moment of the video is shown when motion is reduced

// Characters from sparse to dense. A brighter cell uses a denser row.
const GLYPH_TIERS = [
	'',
	".`'",
	':;,~-',
	'+=<>^*',
	'ijlt/\\|()1{}[]?',
	'rxnuvczXYUJCLQ0OZ',
	'mwqpdbkhao#MW&8%B@$',
];

// Size of one character cell relative to the font size (matches Space Mono, the --mono font).
const CELL_WIDTH = 0.62;
const CELL_HEIGHT = 1.12;

// --- Small helpers -----------------------------------------------------------

/** Deterministic pseudo-random number in [0, 1) from three integers. */
function hash(a, b, c) {
	let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967295;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

/** Reads a hex colour from a CSS custom property, e.g. "--accent" -> [r, g, b]. */
function readCssColor(element, name) {
	const hexValue = getComputedStyle(element).getPropertyValue(name).trim().replace('#', '');
	const n = parseInt(hexValue, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Setting ctx.fillStyle is slow, so colours are rounded to 16 levels per channel and cached.
const colorCache = new Map();
function rgbString(r, g, b) {
	const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
	let value = colorCache.get(key);
	if (!value) {
		value = `rgb(${(r >> 4) * 17}, ${(g >> 4) * 17}, ${(b >> 4) * 17})`;
		colorCache.set(key, value);
	}
	return value;
}

/**
 * The font the characters are drawn in. By default it is --mono (Space Mono). Set --ascii-font (and
 * optionally --ascii-weight) in CSS to use another font. A proportional font works too: every character is
 * centred in its own cell and squeezed to fit, so wide letters like m and W never overlap their neighbours.
 */
function readAsciiFont(element) {
	const style = getComputedStyle(element);
	const family = style.getPropertyValue('--ascii-font').trim() || style.getPropertyValue('--mono');
	const weight = style.getPropertyValue('--ascii-weight').trim() || '400';
	return `${weight} {size}px ${family}`;
}

/** Draws one character centred in its cell, squeezed horizontally if the letter is wider than the cell. */
function drawGlyph(ctx, glyph, x, y, cellWidth) {
	ctx.fillText(glyph, x + cellWidth / 2, y, cellWidth);
}

/** Colour ramp from dark to bright: purple -> purple -> accent -> white. */
function makeRamp(element) {
	return [
		[0, readCssColor(element, '--purple-700')],
		[0.35, readCssColor(element, '--purple-500')],
		[0.72, readCssColor(element, '--accent')],
		[1, [255, 255, 255]],
	];
}

/** Maps a brightness (0-1) to a colour on the ramp. */
function rampColor(ramp, value) {
	const v = clamp(value, 0, 1);
	for (let i = 1; i < ramp.length; i++) {
		const [stopEnd, colorEnd] = ramp[i];
		if (v <= stopEnd) {
			const [stopStart, colorStart] = ramp[i - 1];
			const t = (v - stopStart) / (stopEnd - stopStart);
			return colorStart.map((c, k) => c + (colorEnd[k] - c) * t);
		}
	}
	return [255, 255, 255];
}

// --- Cursor trail (shared by the hero and the page-wide overlay) ----------------

/**
 * Follows the pointer and lights up character cells behind it: a run of blocky, uneven blobs
 * that shrink from head to tail. Read `glow` (one 0-1 value per cell) to draw it.
 */
class CursorTrail {
	constructor(radius) {
		this.radius = radius;      // size of the blob under the pointer, in characters
		this.points = [];
		this.pointer = { x: 0, y: 0, active: false, lastMoved: 0 };
		this.lastUpdate = 0;
		this.glow = new Float32Array(0);        // current brightness per cell, 0-1
		this.glowTarget = new Float32Array(0);  // where the glow is easing towards
	}

	/** Tells the trail the size of the character grid it lives on. Call on load and on resize. */
	resize(cols, rows, cellWidth, cellHeight) {
		this.cols = cols;
		this.rows = rows;
		this.cellWidth = cellWidth;
		this.cellHeight = cellHeight;
		this.cellAspect = cellHeight / cellWidth;
		this.glow = new Float32Array(cols * rows);
		this.glowTarget = new Float32Array(cols * rows);
	}

	/** The pointer moved to (x, y), measured in pixels from the grid's top-left corner. */
	move(x, y, now) {
		const p = this.pointer;
		if (Math.abs(x - p.x) + Math.abs(y - p.y) > 0.5) p.lastMoved = now;
		p.x = x;
		p.y = y;
		p.active = true;
	}

	/** The pointer left, or moved somewhere the trail should not draw. */
	leave() {
		this.pointer.active = false;
	}

	/** True while there is anything to draw. */
	get visible() {
		return this.points.length > 0 || this.glow.some((value) => value > 0.01);
	}

	update(now) {
		this.addPoints(now);
		while (this.points.length && now - this.points[0].born > TRAIL.lifetimeMs) this.points.shift();
		if (now - this.lastUpdate < 1000 / TRAIL.updatesPerSecond) return;
		this.lastUpdate = now;

		this.glowTarget.fill(0);
		for (const point of this.points) this.stamp(point, now);
		for (let i = 0; i < this.glow.length; i++) {
			const target = this.glowTarget[i];
			this.glow[i] += (target - this.glow[i]) * (target > this.glow[i] ? 0.6 : 0.18); // fast in, slow out
		}
	}

	/** Adds points while the pointer is moving. */
	addPoints(now) {
		const p = this.pointer;
		if (!p.active || now - p.lastMoved > 120) return;

		// Continue from the previous point if it is recent, so fast swipes leave an unbroken line.
		const last = this.points[this.points.length - 1];
		const from = last && now - last.born < 150 ? last : { x: p.x, y: p.y };
		const distance = Math.hypot(p.x - from.x, p.y - from.y);
		const steps = Math.max(1, Math.ceil(distance / (this.cellWidth * 3)));
		for (let s = 1; s <= steps; s++) {
			this.points.push({
				x: from.x + ((p.x - from.x) * s) / steps,
				y: from.y + ((p.y - from.y) * s) / steps,
				born: now,
				seed: Math.floor(Math.random() * 1000), // gives each blob its own uneven edge
			});
		}
	}

	/** Marks the cells covered by one point as lit. Newer points are bigger. */
	stamp(point, now) {
		const age = (now - point.born) / TRAIL.lifetimeMs;
		const radius = Math.round(this.radius * (1 - age) ** TRAIL.taper);
		if (radius < 1) return;

		// Snap to a 2-cell grid so the shapes look blocky.
		const centerCol = Math.floor(point.x / this.cellWidth / 2) * 2 + 1;
		const centerRow = Math.floor(point.y / this.cellHeight / 2) * 2 + 1;
		const reach = radius * 1.9; // the uneven edge can extend past the base radius
		const colFrom = Math.max(0, Math.floor(centerCol - reach));
		const colTo = Math.min(this.cols - 1, Math.ceil(centerCol + reach));
		const rowFrom = Math.max(0, Math.floor(centerRow - reach / this.cellAspect));
		const rowTo = Math.min(this.rows - 1, Math.ceil(centerRow + reach / this.cellAspect));

		for (let row = rowFrom; row <= rowTo; row++) {
			for (let col = colFrom; col <= colTo; col++) {
				const dx = col - centerCol;
				const dy = (row - centerRow) * this.cellAspect;
				const angle = Math.atan2(dy, dx);
				const wobble = 1 + 0.28 * Math.sin(angle * 3 + point.seed) + 0.14 * Math.sin(angle * 5 + point.seed * 2.3);
				const limit = radius * wobble * (0.8 + 0.4 * hash(col, row, point.seed));
				if (dx * dx + dy * dy < limit * limit) this.glowTarget[row * this.cols + col] = 1;
			}
		}
	}
}

// --- The hero ------------------------------------------------------------------

class AsciiHero {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.parent = canvas.parentElement;
		this.font = readAsciiFont(canvas);
		this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		const data = canvas.dataset;
		this.sources = (data.video || '').split(/\s+/).filter(Boolean);
		this.baseCellSize = Number(data.cellSize) || 18;
		this.speed = Number(data.speed) || 1;
		this.trailRadius = Number(data.trailRadius) || 16;
		this.dots = data.style === 'dots';   // a halftone of round dots instead of characters

		this.ramp = makeRamp(canvas);

		// One pixel of this small canvas = one character on screen.
		this.frameCanvas = document.createElement('canvas');
		this.frameCtx = this.frameCanvas.getContext('2d', { willReadFrequently: true });

		// A tiny copy of each video frame, used to find where the bright subject is.
		this.probeCanvas = document.createElement('canvas');
		this.probeCanvas.width = 48;
		this.probeCanvas.height = 27;
		this.probeCtx = this.probeCanvas.getContext('2d', { willReadFrequently: true });
		this.cropFocus = 0.5; // horizontal position (0-1) the crop window follows on narrow screens

		this.trail = new CursorTrail(this.trailRadius);
		this.lastDraw = 0;
		this.visible = true;
		this.running = true;
		this.startTime = performance.now();

		this.measure();
		this.video = this.createVideo();
		this.watchEvents();

		if (this.reducedMotion) {
			this.video.addEventListener('seeked', () => this.drawStill());
		} else {
			requestAnimationFrame((now) => this.loop(now));
		}
	}

	// ---- Layout ----

	/** Works out how many character cells fit on the canvas. Runs on load and on resize. */
	measure() {
		this.width = Math.max(1, this.canvas.clientWidth);
		this.height = Math.max(1, this.canvas.clientHeight);
		this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		this.canvas.width = Math.round(this.width * this.pixelRatio);
		this.canvas.height = Math.round(this.height * this.pixelRatio);

		// Smaller characters on phones so the picture keeps enough detail.
		this.fontSize = this.width < 700 ? this.baseCellSize * 0.7 : this.baseCellSize;
		this.cellWidth = this.fontSize * CELL_WIDTH;
		this.cellHeight = this.fontSize * CELL_HEIGHT;
		if (this.dots) this.cellWidth = this.cellHeight = this.fontSize * 0.72;   // dots sit on a square grid
		this.cols = Math.ceil(this.width / this.cellWidth);
		this.rows = Math.ceil(this.height / this.cellHeight);
		this.cellAspect = this.cellHeight / this.cellWidth;

		this.frameCanvas.width = this.cols;
		this.frameCanvas.height = this.rows;
		this.trail.resize(this.cols, this.rows, this.cellWidth, this.cellHeight);
	}

	// ---- Video ----

	createVideo() {
		const video = document.createElement('video');
		video.className = 'ascii-video'; // kept in the page but hidden (see site.css); phones need that
		video.muted = true;
		video.loop = true;
		video.playsInline = true;
		video.autoplay = !this.reducedMotion;
		video.preload = 'auto';
		video.setAttribute('aria-hidden', 'true');
		video.playbackRate = this.speed;

		// The browser picks the first <source> it can actually play.
		for (const url of this.sources) {
			const source = document.createElement('source');
			source.src = url;
			source.type = url.endsWith('.webm') ? 'video/webm' : 'video/mp4';
			video.appendChild(source);
		}
		document.body.appendChild(video);
		video.addEventListener('loadedmetadata', () => {
			video.playbackRate = this.speed;
			if (this.reducedMotion) {
				video.currentTime = Math.min(STILL_FRAME_SECONDS, video.duration - 0.2);
			}
		});
		return video;
	}

	/** Autoplay can be blocked (data saver, low-power mode). Starting on the first touch fixes it. */
	tryPlay() {
		if (this.reducedMotion) return;
		this.video.play().catch(() => {});
	}

	/**
   * Draws the current video frame into the small frame canvas (one pixel per character).
   * Returns false if the video has no frame yet.
   */
	grabFrame() {
		const video = this.video;
		if (video.readyState < 2 || !video.videoWidth) return false;

		const screenRatio = this.width / this.height;
		const videoRatio = video.videoWidth / video.videoHeight;
		let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;

		if (videoRatio > screenRatio) {
			// The video is wider than the screen: crop the sides.
			sw = video.videoHeight * screenRatio;
			sx = this.cropLeft(sw);
		} else {
			sh = video.videoWidth / screenRatio;
			sy = (video.videoHeight - sh) / 2;
		}
		this.frameCtx.drawImage(video, sx, sy, sw, sh, 0, 0, this.cols, this.rows);
		return true;
	}

	/** Left edge of the crop window. On narrow screens it follows the brightest part of the frame. */
	cropLeft(cropWidth) {
		const video = this.video;
		const centred = (video.videoWidth - cropWidth) / 2;
		const veryNarrow = video.videoWidth / video.videoHeight > (this.width / this.height) * 1.3;
		if (!veryNarrow) return centred;

		const { width, height } = this.probeCanvas;
		this.probeCtx.drawImage(video, 0, 0, width, height);
		const pixels = this.probeCtx.getImageData(0, 0, width, height).data;

		let weightSum = 0;
		let xSum = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 4;
				const brightness = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
				const weight = brightness > 0.25 ? (brightness - 0.25) ** 2 : 0;
				weightSum += weight;
				xSum += weight * ((x + 0.5) / width);
			}
		}
		if (weightSum > 0.05) {
			this.cropFocus += (xSum / weightSum - this.cropFocus) * 0.12; // ease so the crop doesn't jump
		}
		return clamp(this.cropFocus * video.videoWidth - cropWidth / 2, 0, video.videoWidth - cropWidth);
	}

	// ---- Events ----

	watchEvents() {
		// The canvas ignores the mouse, so listen on its parent instead.
		this.parent.addEventListener('pointermove', (event) => {
			const rect = this.canvas.getBoundingClientRect();
			this.trail.move(event.clientX - rect.left, event.clientY - rect.top, performance.now());
		});
		this.parent.addEventListener('pointerleave', () => this.trail.leave());

		new ResizeObserver(() => {
			this.measure();
			if (this.reducedMotion) this.drawStill();
		}).observe(this.canvas);

		// Pause when scrolled out of view.
		new IntersectionObserver((entries) => { this.visible = entries[0].isIntersecting; }).observe(this.canvas);

		for (const type of ['touchstart', 'pointerdown', 'keydown']) {
			window.addEventListener(type, () => this.tryPlay(), { once: true, passive: true });
		}
	}

	// ---- Drawing ----

	/** Draws the whole ASCII picture from the current frame canvas. */
	paint(seconds) {
		const pixels = this.frameCtx.getImageData(0, 0, this.cols, this.rows).data;
		const ctx = this.ctx;
		ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
		ctx.clearRect(0, 0, this.width, this.height);
		ctx.font = this.font.replace('{size}', this.fontSize);
		ctx.textBaseline = 'top';
		ctx.textAlign = 'center';

		for (let row = 0; row < this.rows; row++) {
			for (let col = 0; col < this.cols; col++) {
				const i = row * this.cols + col;
				const glow = this.trail.glow[i];

				// Each character re-rolls about 4 times a second, staggered so the picture shimmers.
				const shimmerStep = Math.floor(seconds * 4 + ((col * 31 + row * 17) % 4) * 0.25);

				// 1. Brightness of this cell, squeezed into the floor-ceiling range.
				const luma = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
				let value = Math.min(1, luma ** LOOK.gamma * LOOK.gain);
				value = LOOK.floor + value * (LOOK.ceiling - LOOK.floor);
				value += (hash(col, row, shimmerStep) - 0.5) * LOOK.noise;

				if (this.dots) { this.paintDot(ctx, col, row, value, glow); continue; }

				// 2. A brighter cell gets a denser character.
				const tier = clamp(Math.floor(value * 8), 1, GLYPH_TIERS.length - 1);
				const glyphs = GLYPH_TIERS[tier];
				const glyph = glyphs.charAt(Math.floor(hash(col + 5, row + 9, shimmerStep) * glyphs.length));

				// 3. Colour from the ramp. Under the trail it is more saturated and brighter.
				let [r, g, b] = rampColor(this.ramp, value);
				if (glow > 0.02) {
					const grey = 0.3 * r + 0.59 * g + 0.11 * b;
					const saturation = 1 + glow * TRAIL.saturation;
					r = clamp(grey + (r - grey) * saturation, 0, 255);
					g = clamp(grey + (g - grey) * saturation, 0, 255);
					b = clamp(grey + (b - grey) * saturation, 0, 255);
				}
				const brightness = LOOK.dim + (TRAIL.brightness - LOOK.dim) * glow;
				const x = col * this.cellWidth;
				const y = row * this.cellHeight;

				// 4. A block of colour behind the letter keeps shapes readable at large sizes.
				const block = LOOK.blockStrength * brightness;
				ctx.fillStyle = rgbString(Math.min(255, r * block), Math.min(255, g * block), Math.min(255, b * block));
				ctx.fillRect(x, y, this.cellWidth + 0.6, this.cellHeight + 0.6);

				const letter = brightness * LOOK.letterBoost;
				ctx.fillStyle = rgbString(Math.min(255, r * letter), Math.min(255, g * letter), Math.min(255, b * letter));
				drawGlyph(ctx, glyph, x, y, this.cellWidth);
			}
		}
	}

	/** Dots mode: one round dot per cell. Brighter areas get bigger, brighter dots (a halftone). */
	paintDot(ctx, col, row, value, glow) {
		const t = clamp((value - LOOK.floor) / (LOOK.ceiling - LOOK.floor), 0, 1);
		const radius = this.cellWidth * 0.5 * clamp((0.16 + 0.84 * t) * (1 + 0.35 * glow), 0, 1.15);
		if (radius < 0.5) return;

		let [r, g, b] = rampColor(this.ramp, value);
		if (glow > 0.02) {
			const grey = 0.3 * r + 0.59 * g + 0.11 * b;
			const saturation = 1 + glow * TRAIL.saturation;
			r = clamp(grey + (r - grey) * saturation, 0, 255);
			g = clamp(grey + (g - grey) * saturation, 0, 255);
			b = clamp(grey + (b - grey) * saturation, 0, 255);
		}
		const brightness = LOOK.dim + (TRAIL.brightness - LOOK.dim) * glow;
		ctx.fillStyle = rgbString(Math.min(255, r * brightness), Math.min(255, g * brightness), Math.min(255, b * brightness));
		ctx.beginPath();
		ctx.arc((col + 0.5) * this.cellWidth, (row + 0.5) * this.cellHeight, radius, 0, Math.PI * 2);
		ctx.fill();
	}

	/** One still picture for visitors who prefer reduced motion. */
	drawStill() {
		if (this.grabFrame()) this.paint(STILL_FRAME_SECONDS);
	}

	loop(now) {
		if (!this.running) return;
		requestAnimationFrame((t) => this.loop(t));
		if (!this.visible || now - this.lastDraw < 1000 / FRAMES_PER_SECOND) return;
		this.lastDraw = now;

		if (this.video.paused) this.tryPlay();
		if (!this.grabFrame()) return; // video not ready yet: the page background shows through
		this.trail.update(performance.now());
		this.paint((now - this.startTime) / 1000);
	}
}

// --- The decorative rocket ------------------------------------------------------

/** Sets a fill colour that is white at the given brightness (0-1). Brightness is all that matters here. */
function shade(ctx, brightness) {
	ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
}

/**
 * Draws a slender two-stage launch vehicle pointing right, centred on the origin, on a black canvas.
 * Brightness is what matters: the picture is turned into characters afterwards, and brighter means a
 * denser character in a brighter colour. Because the final picture is so coarse, the details that
 * survive are the long thin silhouette, the pale fairing, the dark joints between sections and the
 * exhaust. `length` is the rocket's length in canvas units (the exhaust extends beyond it).
 */
function drawRocket(ctx, seconds, length) {
	const L = length;
	const h = 0.065 * L;         // half the body thickness: long and thin like a real launch vehicle, but thick enough to survive as characters
	const tail = -0.5 * L;       // x of the engines
	const nose = 0.5 * L;

	// -- Exhaust: a big, roaring plume. A hot glow at the nozzle, a long flickering flame with bright
	//    shock diamonds streaming down it, flying sparks, and a wide trail of smoke behind. --
	const flicker = 1 + 0.14 * Math.sin(seconds * 38) + 0.09 * Math.sin(seconds * 61) + 0.05 * Math.sin(seconds * 97);
	const plumeLength = 0.85 * L * flicker;
	const plumeHalf = (f) => h * (0.7 + 1.4 * f) * (1 - 0.8 * f * f);     // wide, billowing outwards, then tapering
	const jitter = (k) => 1 + 0.2 * Math.sin(seconds * 45 + k * 1.9) + 0.12 * Math.sin(seconds * 83 + k * 3.1);

	const glowRadius = 0.32 * L * (1 + 0.1 * Math.sin(seconds * 31));
	const glow = ctx.createRadialGradient(tail, 0, 0, tail, 0, glowRadius);
	glow.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
	glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
	ctx.fillStyle = glow;
	ctx.fillRect(tail - glowRadius, -glowRadius, glowRadius * 2, glowRadius * 2);

	const plume = ctx.createLinearGradient(tail, 0, tail - plumeLength, 0);
	plume.addColorStop(0, 'rgba(255, 255, 255, 1)');
	plume.addColorStop(0.4, 'rgba(255, 255, 255, 0.9)');
	plume.addColorStop(0.8, 'rgba(255, 255, 255, 0.4)');
	plume.addColorStop(1, 'rgba(255, 255, 255, 0)');
	ctx.fillStyle = plume;
	ctx.beginPath();
	const steps = 20;
	for (let k = 0; k <= steps; k++) {
		const f = k / steps;
		ctx.lineTo(tail - f * plumeLength, -plumeHalf(f) * jitter(k));
	}
	for (let k = steps; k >= 0; k--) {
		const f = k / steps;
		ctx.lineTo(tail - f * plumeLength, plumeHalf(f) * jitter(k + 40));
	}
	ctx.closePath();
	ctx.fill();

	for (let k = 0; k < 7; k++) {
		const f = (((k + seconds * 3.6) % 7) / 7) * 0.9;     // diamonds race down the plume
		ctx.beginPath();
		ctx.ellipse(tail - f * plumeLength, 0, 0.035 * L * (1 - f), plumeHalf(f) * 0.65, 0, 0, Math.PI * 2);
		shade(ctx, 1 - f * 0.8);
		ctx.fill();
	}

	// Sparks flung out and back from the flame.
	for (let i = 0; i < 22; i++) {
		const age = (seconds * 1.6 + hash(i, 1, 7)) % 1;
		const x = tail - age * (0.5 + 0.9 * hash(i, 2, 7)) * L;
		const y = (hash(i, 3, 7) - 0.5) * 2 * plumeHalf(Math.min(1, age)) * (1 + age);
		shade(ctx, 0.9 * (1 - age));
		ctx.fillRect(x, y, 0.012 * L, 0.012 * L);
	}

	// A wide trail of smoke well behind the plume, drifting back.
	for (let i = 0; i < 14; i++) {
		const age = (seconds * 0.8 + i / 14) % 1;
		const x = tail - plumeLength * 0.8 - age * 0.7 * L;
		const y = Math.sin(age * 7 + i) * 0.06 * L * age;
		const radius = (0.03 + 0.11 * age) * L;
		const puff = ctx.createRadialGradient(x, y, 0, x, y, radius);
		puff.addColorStop(0, `rgba(255, 255, 255, ${0.35 * (1 - age)})`);
		puff.addColorStop(1, 'rgba(255, 255, 255, 0)');
		ctx.fillStyle = puff;
		ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
	}

	// -- Landing legs and engine bells at the tail. --
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
	ctx.lineWidth = 0.006 * L;
	for (const side of [-1, 1]) {
		ctx.beginPath();
		ctx.moveTo(tail + 0.08 * L, side * h);
		ctx.lineTo(tail - 0.015 * L, side * h * 2.6);
		ctx.stroke();
	}
	shade(ctx, 0.4);
	ctx.fillRect(tail, -h * 0.75, 0.03 * L, h * 1.5);

	// -- Body: a cylinder lit from above, so it is brightest near the top edge and dark underneath. --
	const body = ctx.createLinearGradient(0, -h, 0, h);
	body.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
	body.addColorStop(0.25, 'rgba(255, 255, 255, 1)');
	body.addColorStop(0.6, 'rgba(255, 255, 255, 0.7)');
	body.addColorStop(1, 'rgba(255, 255, 255, 0.35)');
	ctx.fillStyle = body;
	ctx.fillRect(tail + 0.03 * L, -h, 0.77 * L, h * 2);

	// -- Fairing: a long pointed nose cone on top. --
	ctx.beginPath();
	ctx.moveTo(0.3 * L, -h);
	ctx.quadraticCurveTo(0.43 * L, -h * 0.9, nose, 0);
	ctx.quadraticCurveTo(0.43 * L, h * 0.9, 0.3 * L, h);
	ctx.closePath();
	ctx.fillStyle = body;
	ctx.fill();

	// -- Dark soot at the base, and the joints between stages and the fairing. --
	const soot = ctx.createLinearGradient(tail + 0.03 * L, 0, tail + 0.2 * L, 0);
	soot.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
	soot.addColorStop(1, 'rgba(0, 0, 0, 0)');
	ctx.fillStyle = soot;
	ctx.fillRect(tail + 0.03 * L, -h, 0.17 * L, h * 2);

	ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
	for (const x of [0.1 * L, 0.3 * L]) ctx.fillRect(x - 0.004 * L, -h, 0.008 * L, h * 2);
	ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
	ctx.fillRect(0.1 * L, -h, 0.04 * L, h * 2);   // darker interstage

	// -- Small grid fins near the top of the first stage. --
	shade(ctx, 0.6);
	for (const side of [-1, 1]) {
		ctx.fillRect(0.06 * L, side > 0 ? h : -h * 1.9, 0.014 * L, h * 0.9);
	}
}

class AsciiField {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.font = readAsciiFont(canvas);
		this.ramp = makeRamp(canvas);

		const data = canvas.dataset;
		this.cellSize = Number(data.cellSize) || 14;
		this.angle = ((Number(data.angle) || 0) * Math.PI) / 180;
		this.positionX = data.x === undefined ? 0.8 : Number(data.x);
		this.positionY = data.y === undefined ? 0.5 : Number(data.y);
		this.size = Number(data.size) || 0.5;

		// One pixel of this small canvas = one character on screen.
		this.shapeCanvas = document.createElement('canvas');
		this.shapeCtx = this.shapeCanvas.getContext('2d', { willReadFrequently: true });

		this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		this.visible = true;
		this.lastDraw = 0;
		this.startTime = performance.now();

		this.measure();
		new ResizeObserver(() => { this.measure(); this.paint(0); }).observe(canvas);
		new IntersectionObserver((entries) => { this.visible = entries[0].isIntersecting; }).observe(canvas);

		this.paint(0);
		if (!this.reducedMotion) requestAnimationFrame((now) => this.loop(now));
	}

	measure() {
		this.width = Math.max(1, this.canvas.clientWidth);
		this.height = Math.max(1, this.canvas.clientHeight);
		this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		this.canvas.width = Math.round(this.width * this.pixelRatio);
		this.canvas.height = Math.round(this.height * this.pixelRatio);
		this.cellWidth = this.cellSize * CELL_WIDTH;
		this.cellHeight = this.cellSize * CELL_HEIGHT;
		this.cols = Math.ceil(this.width / this.cellWidth);
		this.rows = Math.ceil(this.height / this.cellHeight);
		this.cellAspect = this.cellHeight / this.cellWidth;
		this.shapeCanvas.width = this.cols;
		this.shapeCanvas.height = this.rows;
	}

	/** Draws the rocket at low resolution, one pixel per character. */
	drawShape(seconds) {
		const ctx = this.shapeCtx;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, this.cols, this.rows);

		// Work in units of one character width, so shapes are not squashed by tall characters.
		ctx.setTransform(1, 0, 0, 1 / this.cellAspect, 0, 0);
		// Size the rocket to fit: no wider than data-size (a fraction of the canvas width), and no taller than the canvas allows.
		const heightUnits = this.rows * this.cellAspect;
		const heightPerLength = 0.95 * Math.abs(Math.sin(this.angle)) + 0.15; // how tall the rocket is, per unit of length
		const length = Math.min(this.cols * this.size, (heightUnits * 0.9) / heightPerLength);
		const bob = Math.sin(seconds * 0.9) * 0.02 * length;     // gentle hover, stays in one place
		const sway = Math.sin(seconds * 0.6) * 0.03;              // tiny rocking
		// Keep the nose inside the canvas, however the rocket is angled.
		const noseReach = 0.5 * length * Math.abs(Math.cos(this.angle)) + 2;
		const centerX = Math.min(this.positionX * this.cols, this.cols - noseReach);
		ctx.translate(centerX, this.positionY * this.rows * this.cellAspect + bob);
		ctx.rotate(this.angle + sway);
		drawRocket(ctx, seconds, length);
	}

	paint(seconds) {
		this.drawShape(seconds);
		const pixels = this.shapeCtx.getImageData(0, 0, this.cols, this.rows).data;
		const ctx = this.ctx;
		ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
		ctx.clearRect(0, 0, this.width, this.height);
		ctx.font = this.font.replace('{size}', this.cellSize);
		ctx.textBaseline = 'top';
		ctx.textAlign = 'center';

		for (let row = 0; row < this.rows; row++) {
			for (let col = 0; col < this.cols; col++) {
				const value = pixels[(row * this.cols + col) * 4] / 255;
				if (value < 0.07) continue;

				const shimmerStep = Math.floor(seconds * 3 + ((col * 31 + row * 17) % 4) * 0.25);
				const tier = clamp(Math.ceil(value * 6), 1, GLYPH_TIERS.length - 1);
				const glyphs = GLYPH_TIERS[tier];
				const glyph = glyphs.charAt(Math.floor(hash(col + 5, row + 9, shimmerStep) * glyphs.length));

				const [r, g, b] = rampColor(this.ramp, value * 0.95);
				ctx.fillStyle = rgbString(r, g, b);
				drawGlyph(ctx, glyph, col * this.cellWidth, row * this.cellHeight, this.cellWidth);
			}
		}
	}

	loop(now) {
		requestAnimationFrame((t) => this.loop(t));
		if (!this.visible || now - this.lastDraw < 1000 / 12) return;
		this.lastDraw = now;
		this.paint((now - this.startTime) / 1000);
	}
}

// --- The page-wide trail ---------------------------------------------------------

/**
 * A transparent canvas over the whole window. Wherever the pointer moves (except over the hero, which
 * draws its own trail on the video) it leaves the same tapering trail, drawn as characters.
 */
class PageTrail {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.font = readAsciiFont(canvas);
		this.ramp = makeRamp(canvas);
		this.cellSize = Number(canvas.dataset.cellSize) || 14;
		this.trail = new CursorTrail(Number(canvas.dataset.trailRadius) || 12);
		this.hero = document.querySelector('.hero');
		this.lastDraw = 0;
		this.cleared = true;

		this.measure();
		window.addEventListener('resize', () => this.measure());
		window.addEventListener('pointermove', (event) => this.onMove(event), { passive: true });
		document.addEventListener('pointerleave', () => this.trail.leave());
		requestAnimationFrame((now) => this.loop(now));
	}

	measure() {
		this.width = window.innerWidth;
		this.height = window.innerHeight;
		this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		this.canvas.width = Math.round(this.width * this.pixelRatio);
		this.canvas.height = Math.round(this.height * this.pixelRatio);
		this.cellWidth = this.cellSize * CELL_WIDTH;
		this.cellHeight = this.cellSize * CELL_HEIGHT;
		this.cols = Math.ceil(this.width / this.cellWidth);
		this.rows = Math.ceil(this.height / this.cellHeight);
		this.trail.resize(this.cols, this.rows, this.cellWidth, this.cellHeight);
	}

	onMove(event) {
		const overHero = this.hero && event.clientY < this.hero.getBoundingClientRect().bottom;
		if (overHero) this.trail.leave();
		else this.trail.move(event.clientX, event.clientY, performance.now());
	}

	paint() {
		const ctx = this.ctx;
		ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
		ctx.clearRect(0, 0, this.width, this.height);
		ctx.font = this.font.replace('{size}', this.cellSize);
		ctx.textBaseline = 'top';
		ctx.textAlign = 'center';

		const seconds = performance.now() / 1000;
		for (let row = 0; row < this.rows; row++) {
			for (let col = 0; col < this.cols; col++) {
				const glow = this.trail.glow[row * this.cols + col];
				if (glow < 0.06) continue;

				const shimmerStep = Math.floor(seconds * 6 + ((col * 31 + row * 17) % 4) * 0.25);
				const tier = clamp(Math.ceil(glow * 6), 1, GLYPH_TIERS.length - 1);
				const glyphs = GLYPH_TIERS[tier];
				const glyph = glyphs.charAt(Math.floor(hash(col + 5, row + 9, shimmerStep) * glyphs.length));

				// Kept faint so it never fights with text that is drawn on top of it.
				const [r, g, b] = rampColor(this.ramp, 0.3 + glow * 0.4);
				ctx.globalAlpha = Math.min(0.4, glow * 0.55);
				ctx.fillStyle = rgbString(r, g, b);
				drawGlyph(ctx, glyph, col * this.cellWidth, row * this.cellHeight, this.cellWidth);
			}
		}
		ctx.globalAlpha = 1;
	}

	loop(now) {
		requestAnimationFrame((t) => this.loop(t));
		if (now - this.lastDraw < 1000 / FRAMES_PER_SECOND) return;
		this.lastDraw = now;

		this.trail.update(performance.now());
		if (this.trail.visible) {
			this.paint();
			this.cleared = false;
		} else if (!this.cleared) {
			this.ctx.clearRect(0, 0, this.width, this.height);
			this.cleared = true;
		}
	}
}

// --- Start -----------------------------------------------------------------------

// Wait for the font so character sizes are measured correctly.
const start = () => {
	document.querySelectorAll('canvas[data-video]').forEach((canvas) => new AsciiHero(canvas));
	document.querySelectorAll('canvas[data-shape]').forEach((canvas) => new AsciiField(canvas));
	if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		document.querySelectorAll('canvas[data-page-trail]').forEach((canvas) => new PageTrail(canvas));
	}
};
if (document.fonts && document.fonts.ready) {
	document.fonts.ready.then(start, start);
} else {
	start();
}
