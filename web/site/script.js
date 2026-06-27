/* ========================================
   Lyra Landing Page — Interactions & Animations
   ======================================== */

(function () {
  'use strict';

  /* --- Intersection Observer for scroll animations --- */
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -60px 0px',
    threshold: 0.1,
  };

  function createObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all animated elements
    const selectors = [
      '.feature-card',
      '.tech-item',
      '.arch-diagram',
      '.animate-in',
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        observer.observe(el);
      });
    });
  }

  /* --- Staggered animation delays for tech items --- */
  function applyStaggerDelays() {
    document.querySelectorAll('.tech-item').forEach((item, i) => {
      item.style.transitionDelay = `${i * 0.08}s`;
    });

    document.querySelectorAll('.feature-card').forEach((card, i) => {
      card.style.transitionDelay = `${i * 0.08}s`;
    });
  }

  /* --- Smooth scroll for anchor links --- */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  /* --- Navbar shrink on scroll (if nav exists) --- */
  function initNavScroll() {
    const nav = document.querySelector('.nav');
    if (!nav) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          nav.classList.toggle('nav-scrolled', window.scrollY > 40);
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  /* --- Parallax subtle glow movement on mouse --- */
  function initGlowParallax() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    hero.addEventListener('mousemove', (e) => {
      const rect = hero.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 30;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 20;

      hero.style.setProperty('--glow-x', `${50 + x * 0.3}%`);
      hero.style.setProperty('--glow-y', `${30 + y * 0.3}%`);
    });
  }

  /* --- ASCII logo subtle shimmer --- */
  function initAsciiShimmer() {
    const ascii = document.querySelector('.hero-ascii');
    if (!ascii) return;

    // Add a CSS custom property for shimmer position
    let angle = 0;
    function shimmer() {
      angle += 0.5;
      const opacity = 0.35 + Math.sin(angle * 0.02) * 0.15;
      ascii.style.color = `rgba(124, 91, 245, ${opacity})`;
      requestAnimationFrame(shimmer);
    }
    // Start after initial animation
    setTimeout(shimmer, 2500);
  }

  /* --- Button hover glow effect --- */
  function initButtonGlow() {
    document.querySelectorAll('.btn').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        btn.style.setProperty('--mouse-x', `${x}px`);
        btn.style.setProperty('--mouse-y', `${y}px`);
      });
    });
  }

  /* --- Init --- */
  function init() {
    applyStaggerDelays();
    createObserver();
    initSmoothScroll();
    initNavScroll();
    initGlowParallax();
    initAsciiShimmer();
    initButtonGlow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
