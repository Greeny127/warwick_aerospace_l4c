// Page behaviour: scroll reveals, the floating header, the phone menu,
// the four-teams list and the team grid.

// Fade things in as they scroll into view. The CSS does the animating.
const revealer = new IntersectionObserver((entries) => {
	for (const entry of entries) {
		if (!entry.isIntersecting) continue;
		entry.target.classList.add('in');
		revealer.unobserve(entry.target);
	}
}, { threshold: 0.15 });

document.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));


// Record chart. Between 901px and 1420px wide the desktop layout is kept but
// shrunk to fit (the CSS gives it a fixed width of 1260px).
const chart = document.querySelector('.rec-chart');

function fitChart() {
	chart.style.zoom = '';
	if (innerWidth < 901 || innerWidth > 1420) return;

	const section = chart.parentElement;
	const style = getComputedStyle(section);
	const room = section.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	chart.style.zoom = Math.min(1, room / 1260);
}

fitChart();
addEventListener('resize', fitChart);


// Header. It slides away when you scroll down and comes back when you
// scroll up, or when the mouse goes near the top of the window.
const bar = document.getElementById('bar');
const menuButton = bar.querySelector('.menu-btn');
let lastY = 0;
let scrolledDown = false;
let nearTop = false;

function updateHeader() {
	const hidden = scrolledDown && !nearTop && !bar.classList.contains('open');
	bar.classList.toggle('hide', hidden);
}

addEventListener('scroll', () => {
	scrolledDown = scrollY > lastY && scrollY > 200;
	lastY = scrollY;
	updateHeader();
}, { passive: true });

addEventListener('mousemove', (event) => {
	const near = event.clientY < 110;
	if (near === nearTop) return;
	nearTop = near;
	updateHeader();
}, { passive: true });

document.addEventListener('mouseleave', () => {
	nearTop = false;
	updateHeader();
});


// Phone menu
function setMenu(open) {
	bar.classList.toggle('open', open);
	menuButton.setAttribute('aria-expanded', String(open));
	updateHeader();
}

menuButton.addEventListener('click', () => setMenu(!bar.classList.contains('open')));
bar.querySelectorAll('nav a').forEach((link) => {
	link.addEventListener('click', () => setMenu(false));
});
addEventListener('keydown', (event) => {
	if (event.key === 'Escape') setMenu(false);
});


// Four teams. Clicking one hides the others, moves it to the top (the bottom
// two go to the bottom) and shows its paragraph. Click it again, or press
// Esc, to put everything back.
(function () {
	const list = document.querySelector('.divisions .list');
	if (!list) return;

	const items = [...list.querySelectorAll('.item')];
	const details = [...list.querySelectorAll('.detail')];
	const isOpen = () => list.classList.contains('open');

	let busyTimer;
	let settleTimer;

	// Runs `change`, then slides the rows from where they were to where they
	// are now. Without this the reordering would jump. If `only` is given,
	// just that row slides.
	function flip(change, only) {
		list.classList.add('busy');
		clearTimeout(busyTimer);
		busyTimer = setTimeout(() => list.classList.remove('busy'), 350);

		const before = items.map((item) => item.getBoundingClientRect().top);
		change();

		items.forEach((item, n) => {
			const dy = before[n] - item.getBoundingClientRect().top;
			if (!dy || (only && item !== only)) return;
			item.style.transition = 'none';
			item.style.transform = `translateY(${dy}px)`;
		});

		list.offsetHeight; // force a reflow so the starting positions apply
		items.forEach((item) => {
			item.style.transition = '';
			item.style.transform = '';
		});
	}

	// Animates the list's height to `to`. An empty string means its natural
	// height. The hidden rows are clipped while it shrinks.
	function resize(to) {
		const from = list.offsetHeight;
		list.style.overflow = 'hidden';

		if (to === '') {
			list.style.height = '';
			to = list.offsetHeight;
		}

		list.style.height = from + 'px';
		list.offsetHeight;
		list.style.height = to + 'px';

		clearTimeout(settleTimer);
		if (!isOpen()) {
			settleTimer = setTimeout(() => {
				list.style.height = '';
				list.style.overflow = '';
			}, 450);
		}
	}

	// Puts the paragraph next to the open row: under it, or above it for
	// the bottom two teams.
	function placeDetail(item, detail) {
		const above = list.classList.contains('reverse');
		detail.classList.toggle('above', above);
		detail.style.top = above ? '' : item.offsetHeight + 'px';
		detail.style.bottom = above ? item.offsetHeight + 'px' : '';
	}

	function openItem(item, n) {
		flip(() => {
			list.classList.add('open');
			list.classList.toggle('reverse', n >= 2);

			items.forEach((other) => {
				const active = other === item;
				other.classList.toggle('active', active);
				other.setAttribute('aria-expanded', String(active));
			});

			details.forEach((detail, m) => {
				detail.classList.remove('show');
				detail.hidden = m !== n;
			});
		});

		const detail = details[n];
		placeDetail(item, detail);
		resize(item.offsetHeight + detail.offsetHeight + 24);
		requestAnimationFrame(() => detail.classList.add('show'));
	}

	function close() {
		if (!isOpen()) return;

		flip(() => {
			// the names fade back in after the open row has moved
			list.classList.add('closing');
			setTimeout(() => list.classList.remove('closing'), 700);

			list.classList.remove('open', 'reverse');
			items.forEach((item) => {
				item.classList.remove('active');
				item.setAttribute('aria-expanded', 'false');
			});
			details.forEach((detail) => {
				detail.classList.remove('show');
				detail.hidden = true;
			});
			resize('');
		}, list.querySelector('.item.active'));
	}

	items.forEach((item, n) => {
		item.addEventListener('click', (event) => {
			event.preventDefault();
			if (item.classList.contains('active')) close();
			else openItem(item, n);
		});
	});

	// keep the open height right if the window changes size
	addEventListener('resize', () => {
		const item = list.querySelector('.item.active');
		const detail = list.querySelector('.detail:not([hidden])');
		if (!item || !detail) return;
		placeDetail(item, detail);
		list.style.height = item.offsetHeight + detail.offsetHeight + 24 + 'px';
	});

	addEventListener('keydown', (event) => {
		if (event.key === 'Escape') close();
	});
})();


// Team. The tabs filter one grid of people by subteam. It opens on Leadership
// and steps through the tabs by itself (only while it is on screen) until the
// visitor clicks anything. Clicking a person opens their details in place:
// the tile stretches across the row and the other tiles glide to their new spots.
(function () {
	const section = document.querySelector('#team');
	if (!section) return;

	const chips = [...section.querySelectorAll('.chip')];
	const people = [...section.querySelectorAll('.person')];
	const grid = section.querySelector('.people');
	const calm = matchMedia('(prefers-reduced-motion: reduce)');
	// One motion language for the whole section. Things that appear fade in while
	// rising 18px, one after another. Things that stay glide to their new place.
	// Same duration, same easing, same 50ms stagger everywhere.
	const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
	const DUR = 550;
	const STAGGER = 50;
	const RISE = '18px';
	let current = chips[0].dataset.filter;
	let touched = false;
	let timer = 0;
	let token = 0;

	const visible = () => people.filter((p) => !p.hidden);

	function enter(el, i = 0) {
		if (calm.matches) return;
		el.animate(
			[{ opacity: 0, transform: `translateY(${RISE})` }, { opacity: 1, transform: 'none' }],
			{ duration: DUR, delay: i * STAGGER, easing: EASE, fill: 'backwards' }
		);
	}

	// run a change; tiles that stayed glide from where they were to where they are,
	// and the tile that just opened or closed (`entering`) fades in like any new arrival
	function glide(change, entering) {
		const before = new Map(visible().map((p) => [p, p.getBoundingClientRect()]));
		change();
		if (calm.matches) return;
		visible().forEach((p) => {
			if (p === entering) return;
			const from = before.get(p);
			if (!from) return;
			const to = p.getBoundingClientRect();
			const dx = from.left - to.left;
			const dy = from.top - to.top;
			if (dx || dy) p.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: DUR, easing: EASE });
		});
		if (entering) enter(entering);
	}

	function setOpen(person, open) {
		person.classList.toggle('open', open);
		person.querySelector('.person-bio').hidden = !open;
		person.querySelector('.person-tile').setAttribute('aria-expanded', String(open));
	}

	function closeAll() {
		people.filter((p) => p.classList.contains('open')).forEach((p) => setOpen(p, false));
	}

	// switching tabs: the old tiles fade out together, then the new ones rise in one by one
	async function show(f) {
		current = f;
		const mine = ++token;
		chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === f)));

		const leaving = visible();
		if (leaving.length && !calm.matches) {
			await Promise.all(leaving.map((p) => p.animate(
				[{ opacity: 1 }, { opacity: 0 }],
				{ duration: DUR * 0.35, easing: 'ease-in', fill: 'forwards' }
			).finished));
			if (mine !== token) return;
			leaving.forEach((p) => p.getAnimations().forEach((a) => a.cancel()));
		}

		closeAll();
		people.forEach((p) => { p.hidden = p.dataset.team !== f; });
		visible().forEach((p, i) => enter(p, i));
	}

	// the automatic tour
	function stop() {
		touched = true;
		clearInterval(timer);
	}

	function start() {
		if (touched || calm.matches) return;
		clearInterval(timer);
		timer = setInterval(() => {
			const i = chips.findIndex((c) => c.dataset.filter === current);
			show(chips[(i + 1) % chips.length].dataset.filter);
		}, 4000);
	}

	new IntersectionObserver((entries) => {
		if (entries[0].isIntersecting) start();
		else clearInterval(timer);
	}, { threshold: 0.3 }).observe(section);

	chips.forEach((chip) => chip.addEventListener('click', () => {
		stop();
		show(chip.dataset.filter);
	}));

	people.forEach((person) => {
		const tile = person.querySelector('.person-tile');
		tile.setAttribute('aria-expanded', 'false');
		tile.addEventListener('click', () => {
			stop();
			const wasOpen = person.classList.contains('open');
			glide(() => {
				closeAll();
				if (!wasOpen) setOpen(person, true);
			}, person);
			// the open card sits at the top of the grid, so bring the top of the grid into view.
			// (Measure the grid, not the card: the card is mid-glide and its position is misleading.)
			if (!wasOpen) {
				const top = grid.getBoundingClientRect().top;
				if (top < 110) scrollTo({ top: scrollY + top - 110, behavior: calm.matches ? 'auto' : 'smooth' });
			}
		});
		person.querySelector('.bio-close').addEventListener('click', () => {
			stop();
			glide(() => setOpen(person, false), person);
		});
	});

	addEventListener('keydown', (event) => {
		if (event.key !== 'Escape') return;
		const open = people.find((p) => p.classList.contains('open'));
		if (open) glide(() => setOpen(open, false), open);
	});
})();
