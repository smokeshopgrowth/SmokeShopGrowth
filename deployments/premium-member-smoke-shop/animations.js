/**
 * animations.js
 * Requires GSAP and ScrollTrigger.
 * Aura-inspired: subtle, smooth, premium.
 */

document.addEventListener("DOMContentLoaded", () => {

    // ── Cursor glow (skip on touch devices) ───────────────────────────────
    if (!window.matchMedia('(hover: none)').matches) {
        const cursorGlow = document.getElementById("cursor-glow");
        if (cursorGlow) {
            document.addEventListener("mousemove", (e) => {
                cursorGlow.style.left = e.clientX + "px";
                cursorGlow.style.top = e.clientY + "px";
            });
        }
    }

    // ── Wait briefly for data bindings to populate ─────────────────────────
    setTimeout(() => {
        gsap.registerPlugin(ScrollTrigger);

        // 1. Navbar fade in
        gsap.from(".nav", {
            y: -40,
            opacity: 0,
            duration: 0.9,
            ease: "power3.out"
        });

        // 2. Hero content staggered entrance
        gsap.from(".hero-content > *", {
            y: 25,
            opacity: 0,
            duration: 1,
            stagger: 0.12,
            ease: "power3.out",
            delay: 0.2
        });

        // 3. Hero image fade in & slight scale
        gsap.from(".hero-visual", {
            scale: 0.92,
            opacity: 0,
            duration: 1.3,
            ease: "power3.out",
            delay: 0.35
        });

        // 4. Scroll Reveal Elements (.gs-reveal)
        gsap.utils.toArray(".gs-reveal").forEach(function (elem) {
            gsap.from(elem, {
                scrollTrigger: {
                    trigger: elem,
                    start: "top 85%",
                    toggleActions: "play none none none"
                },
                y: 30,
                opacity: 0,
                duration: 0.9,
                ease: "power3.out"
            });
        });

        // 5. Hero parallax on scroll
        gsap.to(".hero-content", {
            yPercent: -30,
            ease: "none",
            scrollTrigger: {
                trigger: ".hero",
                start: "top top",
                end: "bottom top",
                scrub: true
            }
        });

        gsap.to(".hero-visual", {
            yPercent: -15,
            ease: "none",
            scrollTrigger: {
                trigger: ".hero",
                start: "top top",
                end: "bottom top",
                scrub: true
            }
        });

        // 6. Parallax effect for ambient glows
        gsap.to(".glow-1", {
            yPercent: 25,
            ease: "none",
            scrollTrigger: {
                trigger: "body",
                start: "top top",
                end: "bottom top",
                scrub: true
            }
        });

        // 7. Testimonial cards staggered reveal
        gsap.utils.toArray(".testimonial-card").forEach(function (card, i) {
            gsap.from(card, {
                scrollTrigger: {
                    trigger: card,
                    start: "top 88%",
                    toggleActions: "play none none none"
                },
                y: 30,
                opacity: 0,
                duration: 0.8,
                delay: i * 0.1,
                ease: "power3.out"
            });
        });

        // 8. Pricing card scale-in
        gsap.from(".pricing-card", {
            scrollTrigger: {
                trigger: ".pricing-card",
                start: "top 85%",
                toggleActions: "play none none none"
            },
            scale: 0.9,
            opacity: 0,
            duration: 0.9,
            ease: "power3.out"
        });

    }, 100);

    // ── Ambient Smoke Particle Canvas Effect ────────────────────────────────
    initSmokeCanvas();
});

function initSmokeCanvas() {
    const canvas = document.getElementById("smoke-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let width, height;
    let particles = [];

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    window.addEventListener("resize", resize);
    resize();

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = height + Math.random() * 100;
            this.size = Math.random() * 35 + 15;
            this.speedX = Math.random() * 0.8 - 0.4;
            this.speedY = Math.random() * -0.8 - 0.3;
            const isPurple = Math.random() > 0.5;
            this.color = isPurple ? "rgba(167, 139, 250, 0.025)" : "rgba(52, 211, 153, 0.025)";
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            this.size += 0.08;

            if (this.y < -100) {
                this.y = height + 100;
                this.x = Math.random() * width;
                this.size = Math.random() * 35 + 15;
            }
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();
        }
    }

    // 200 particles (reduced from 350 for performance)
    for (let i = 0; i < 200; i++) {
        particles.push(new Particle());
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
        }
        requestAnimationFrame(animate);
    }

    animate();
}
