// Page behaviour: scroll reveals, the looping ticker, the floating header,
// the phone menu and the four-teams list.

// Fade things in as they scroll into view. The CSS does the animating.
const revealer = new IntersectionObserver((entries) => {
	for (const entry of entries) {
		if (!entry.isIntersecting) continue;
		entry.target.classList.add('in');
		revealer.unobserve(entry.target);
	}
}, { threshold: 0.15 });

document.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));


// Ticker. Copy the word list until it covers the screen twice, then slide
// by exactly one copy so the loop has no jump.
function buildTicker() {
	const track = document.querySelector('.ticker .track');
	const first = track.children[0];

	// start from one copy again (this also runs on resize)
	while (track.children.length > 1) track.lastChild.remove();

	const groupWidth = first.getBoundingClientRect().width;
	const copies = Math.ceil((innerWidth * 2) / groupWidth) + 1;
	for (let i = 1; i < copies; i++) {
		track.appendChild(first.cloneNode(true));
	}

	track.style.setProperty('--ticker-shift', groupWidth + 'px');
	track.style.setProperty('--ticker-duration', groupWidth / 70 + 's'); // 70px a second
}

document.fonts.ready.then(buildTicker);
addEventListener('resize', buildTicker);


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
