/**
 * config.js — Edit this file to customize for each smoke shop client.
 * All fields here will automatically populate throughout the website.
 * 
 * USAGE: Each field can be overridden via URL parameters:
 * ?shop=MyShop&city=Houston&phone=7135550100&rating=4.8
 */

window.BUSINESS = {
    // ── Core Info ─────────────────────────────────────────────────────────────
    name: "Smoke Shop Name",
    city: "Houston",
    state: "TX",
    phone: "(713) 555-0100",
    address: "123 Main St, Houston TX 77001",
    tagline: "Your neighborhood smoke shop",

    // ── Hours ──────────────────────────────────────────────────────────────────
    hours: "Open 9AM – Midnight · 7 Days a Week",

    // ── Links ─────────────────────────────────────────────────────────────────
    instagram: "https://instagram.com/yourshop",
    googleMaps: "https://maps.google.com/?q=123+Main+St+Houston+TX",
    website: "https://yourshop.com",

    // ── Google Business Profile ──────────────────────────────────────────────
    rating: 4.7,
    reviewCount: 156,

    // ── Products ──────────────────────────────────────────────────────────────
    categories: ["Vapes", "CBD", "Kratom", "Hookah", "Delta-8", "Glass Pipes", "Cigars"],

    // ── Pricing (shown on demo page) ──────────────────────────────────────────
    price: "$299 Setup · $29/mo",

    // ── Testimonials ────────────────────────────────────────────────────────
    testimonials: [
        { 
            name: "Mike R.", 
            role: "Shop Owner, Houston", 
            stars: 5, 
            quote: "Had our website up in two days. Already getting more calls from Google." 
        },
        { 
            name: "Sarah T.", 
            role: "Manager, Spring TX", 
            stars: 5, 
            quote: "The site looks amazing on phones. Customers love it." 
        },
        { 
            name: "James L.", 
            role: "Owner, Katy TX", 
            stars: 4, 
            quote: "Simple setup, fair price. Exactly what we needed." 
        },
    ],

    // ── Hero Image Override ──────────────────────────────────────────────────
    heroImage: null, // Set to a URL to override default image

    // ── Theme Colors (optional overrides) ────────────────────────────────────
    // accentColor: "#a78bfa",   // default: soft violet
    // secondColor: "#34d399",   // default: mint/emerald

    // ── Advanced Options ───────────────────────────────────────────────────────
    analyticsId: null, // Google Analytics 4 ID
    enableContactForm: true,
    enablePricing: true,
    showDemoBanner: true,
};

// ── URL Parameter Override System ──────────────────────────────────────────────
// This allows personalization via query strings:
// https://your-domain.com/?shop=My+Shop&city=Austin&state=TX&phone=5125550100
// &address=123+Main+St&rating=4.8&reviews=200&img=https://...
if (typeof window !== "undefined" && window.location && window.location.search) {
    const params = new URLSearchParams(window.location.search);
    
    // Basic Info
    const shop = params.get("shop");
    const city = params.get("city");
    const state = params.get("state");
    const address = params.get("address");
    const phone = params.get("phone");
    const tagline = params.get("tagline");
    
    // Ratings & Social
    const rating = params.get("rating");
    const reviews = params.get("reviews");
    const instagram = params.get("instagram");
    const googleMaps = params.get("gm");
    
    // Media
    const img = params.get("img");
    const heroImage = params.get("hero");
    
    // Apply overrides
    if (shop) window.BUSINESS.name = decodeURIComponent(shop);
    if (city) window.BUSINESS.city = decodeURIComponent(city);
    if (state) window.BUSINESS.state = decodeURIComponent(state);
    if (address) window.BUSINESS.address = decodeURIComponent(address);
    if (phone) {
        // Format phone number
        const digits = phone.replace(/\D/g, '');
        window.BUSINESS.phone = digits.length === 10 ? 
            `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}` :
            phone;
    }
    if (tagline) window.BUSINESS.tagline = decodeURIComponent(tagline);
    if (rating) window.BUSINESS.rating = parseFloat(rating);
    if (reviews) window.BUSINESS.reviewCount = parseInt(reviews);
    if (instagram) window.BUSINESS.instagram = decodeURIComponent(instagram);
    if (googleMaps) window.BUSINESS.googleMaps = decodeURIComponent(googleMaps);
    if (img || heroImage) window.BUSINESS.heroImage = decodeURIComponent(img || heroImage);
}

// ── Optional: Initialize Google Analytics if ID provided ─────────────────────
if (window.BUSINESS.analyticsId) {
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', window.BUSINESS.analyticsId);
    
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${window.BUSINESS.analyticsId}`;
    document.head.appendChild(script);
}
