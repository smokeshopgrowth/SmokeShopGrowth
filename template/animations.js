/**
 * animations.js
 * Smooth, performant animations using GSAP
 */

document.addEventListener("DOMContentLoaded", () => {
  // Wait for GSAP to load
  if (typeof gsap === 'undefined') {
    console.warn('GSAP not loaded, animations disabled');
    // Fallback: reveal all elements
    document.querySelectorAll('.gs-reveal').forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    return;
  }

  // Register ScrollTrigger plugin
  gsap.registerPlugin(ScrollTrigger);

  // ── Initial page load animations ────────────────────────────────────────
  
  // Hero content staggered entrance
  gsap.from(".hero .location-badge", {
    y: 20,
    opacity: 0,
    duration: 0.8,
    ease: "power3.out",
    delay: 0.2
  });

  gsap.from(".hero .hero-title", {
    y: 30,
    opacity: 0,
    duration: 1,
    ease: "power3.out",
    delay: 0.35
  });

  gsap.from(".hero .hero-subtitle", {
    y: 25,
    opacity: 0,
    duration: 0.9,
    ease: "power3.out",
    delay: 0.5
  });

  gsap.from(".hero .hero-actions", {
    y: 20,
    opacity: 0,
    duration: 0.8,
    ease: "power3.out",
    delay: 0.65
  });

  gsap.from(".hero .trust-badges", {
    y: 15,
    opacity: 0,
    duration: 0.7,
    ease: "power3.out",
    delay: 0.8
  });

  // ── Scroll-triggered animations ─────────────────────────────────────────

  // Generic reveal for elements with .gs-reveal
  const revealElements = gsap.utils.toArray(".gs-reveal:not(.hero .gs-reveal)");
  
  revealElements.forEach(elem => {
    gsap.fromTo(elem, 
      {
        y: 30,
        opacity: 0
      },
      {
        y: 0,
        opacity: 1,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: elem,
          start: "top 85%",
          toggleActions: "play none none none"
        }
      }
    );
  });

  // Stats counter animation
  const statValues = document.querySelectorAll('.stat-value');
  
  statValues.forEach(stat => {
    const text = stat.textContent;
    const hasPlus = text.includes('+');
    const numericValue = parseFloat(text.replace(/[^0-9.]/g, ''));
    
    if (!isNaN(numericValue)) {
      const isDecimal = numericValue % 1 !== 0;
      
      ScrollTrigger.create({
        trigger: stat,
        start: "top 85%",
        onEnter: () => {
          gsap.from(stat, {
            textContent: 0,
            duration: 1.5,
            ease: "power2.out",
            snap: isDecimal ? false : { textContent: 1 },
            modifiers: {
              textContent: value => {
                const num = isDecimal 
                  ? parseFloat(value).toFixed(1) 
                  : Math.round(value);
                return hasPlus ? num + '+' : num;
              }
            }
          });
        },
        once: true
      });
    }
  });

  // Product cards staggered reveal
  const productCards = gsap.utils.toArray(".product-card");
  
  if (productCards.length > 0) {
    gsap.fromTo(productCards, 
      {
        y: 40,
        opacity: 0
      },
      {
        y: 0,
        opacity: 1,
        duration: 0.6,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".products-grid",
          start: "top 80%",
          toggleActions: "play none none none"
        }
      }
    );
  }

  // Review cards staggered reveal
  const reviewCards = gsap.utils.toArray(".review-card");
  
  if (reviewCards.length > 0) {
    gsap.fromTo(reviewCards, 
      {
        y: 30,
        opacity: 0
      },
      {
        y: 0,
        opacity: 1,
        duration: 0.6,
        stagger: 0.15,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".reviews-grid",
          start: "top 80%",
          toggleActions: "play none none none"
        }
      }
    );
  }

  // Info cards staggered reveal
  const infoCards = gsap.utils.toArray(".info-card");
  
  if (infoCards.length > 0) {
    gsap.fromTo(infoCards, 
      {
        x: 30,
        opacity: 0
      },
      {
        x: 0,
        opacity: 1,
        duration: 0.6,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".about-info",
          start: "top 80%",
          toggleActions: "play none none none"
        }
      }
    );
  }

  // Contact card reveal
  const contactCard = document.querySelector(".contact-card");
  
  if (contactCard) {
    gsap.fromTo(contactCard, 
      {
        y: 40,
        opacity: 0,
        scale: 0.98
      },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: contactCard,
          start: "top 85%",
          toggleActions: "play none none none"
        }
      }
    );
  }

  // ── Hover animations ────────────────────────────────────────────────────

  // Product card hover effect
  productCards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      gsap.to(card.querySelector('.product-icon'), {
        scale: 1.1,
        duration: 0.3,
        ease: "power2.out"
      });
    });
    
    card.addEventListener('mouseleave', () => {
      gsap.to(card.querySelector('.product-icon'), {
        scale: 1,
        duration: 0.3,
        ease: "power2.out"
      });
    });
  });

  // ── Smooth scroll for anchor links ──────────────────────────────────────

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      
      const target = document.querySelector(href);
      if (!target) return;
      
      e.preventDefault();
      
      const headerOffset = 80;
      const elementPosition = target.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    });
  });

  // ── Parallax effects (subtle) ───────────────────────────────────────────

  const heroBg = document.querySelector('.hero-bg');
  
  if (heroBg && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    gsap.to(heroBg, {
      yPercent: 30,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: true
      }
    });
  }
});
