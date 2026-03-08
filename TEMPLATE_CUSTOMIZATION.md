# Template Customization Examples

This file contains ready-to-use examples for customizing the demo template.

## URL Customization Examples

### Example 1: Austin Vape Shop
```
https://your-domain.com/?shop=Elevated%20Vape&city=Austin&state=TX&phone=5125550123&rating=4.8&reviews=234
```

### Example 2: Los Angeles Smoke Lounge
```
https://your-domain.com/?shop=LA%20Smoke%20Lounge&city=Los%20Angeles&state=CA&phone=2135551234&rating=4.9&reviews=512&instagram=https://instagram.com/lasmokelounge
```

### Example 3: With Custom Hero Image
```
https://your-domain.com/?shop=Premium%20Smoke%20Shop&city=Houston&state=TX&phone=7135551000&img=https://images.unsplash.com/photo-smoke-shop&rating=4.7&reviews=189
```

### Example 4: Full Setup with Analytics
```
https://your-domain.com/?shop=The%20Smoke%20Haven&city=Denver&state=CO&phone=3035552000&rating=4.6&reviews=267&analyticsId=G-ABC123XYZ&instagram=https://instagram.com/smokehaven
```

---

## config.js Customization Examples

### Minimal Config (Smoke Shop)
```javascript
window.BUSINESS = {
    name: "The Smoke Haven",
    city: "Denver",
    state: "CO",
    phone: "(303) 555-2000",
    rating: 4.6,
    reviewCount: 267
};
```

### Standard Config (Small Shop)
```javascript
window.BUSINESS = {
    name: "Urban Smoke",
    city: "Seattle",
    state: "WA",
    phone: "(206) 555-3000",
    address: "123 Pike Street, Seattle WA 98101",
    tagline: "Your neighborhood smoke shop",
    hours: "10AM – 11PM Daily",
    instagram: "https://instagram.com/urbansmoke",
    googleMaps: "https://maps.google.com/?q=123+Pike+Street+Seattle+WA+98101",
    rating: 4.7,
    reviewCount: 312,
    categories: ["Vapes", "CBD", "Hookah", "Glass Pipes", "Kratom"]
};
```

### Premium Config (High-Volume Shop)
```javascript
window.BUSINESS = {
    name: "Elevated Smoke Lounge",
    city: "Austin",
    state: "TX",
    phone: "(512) 555-0123",
    address: "456 Oak Street, Austin TX 78701",
    tagline: "Premium smoke experience & lounge",
    hours: "12PM – 12AM Daily",
    website: "https://elevatedsmoke.com",
    instagram: "https://instagram.com/elevatedsmoke",
    facebook: "https://facebook.com/elevatedsmoke",
    googleMaps: "https://maps.google.com/?q=456+Oak+Street+Austin+TX",
    heroImage: "https://images.unsplash.com/photo-upscale-shop",
    rating: 4.9,
    reviewCount: 564,
    categories: [
        "Premium Cigars",
        "Vaping",
        "CBD & Hemp",
        "Kratom",
        "Hookah",
        "Glass Art",
        "Delta-8 Products",
        "Accessories"
    ],
    testimonials: [
        {
            name: "John Martinez",
            role: "Regular Customer, Austin",
            stars: 5,
            quote: "Best selection in Austin! Staff really knows their stuff."
        },
        {
            name: "Sarah Chen",
            role: "Customer, Austin",
            stars: 5,
            quote: "Love the lounge atmosphere. Perfect place to hang out!"
        },
        {
            name: "Mike Thompson",
            role: "Corporate Event Host",
            stars: 5,
            quote: "Hosted our team event here. Amazing service!"
        }
    ],
    pricingTiers: [
        {
            name: "Starter",
            setup: 199,
            monthly: 19,
            features: ["Web Design", "Mobile Ready", "Contact Form"]
        },
        {
            name: "Growth",
            setup: 299,
            monthly: 29,
            featured: true,
            features: ["All Starter", "Analytics", "Instagram Integration", "Maps"]
        },
        {
            name: "Pro",
            setup: 499,
            monthly: 49,
            features: ["All Growth", "E-commerce", "Inventory System", "Priority Support"]
        }
    ]
};
```

---

## Custom Styling Examples

### Change Brand Colors
Edit `styles.css`:

**Option 1: Purple & Green (Current)**
```css
:root {
    --accent: #a78bfa;      /* Violet */
    --second: #34d399;      /* Emerald */
}
```

**Option 2: Orange & Teal**
```css
:root {
    --accent: #f97316;      /* Orange */
    --second: #06b6d4;      /* Cyan */
}
```

**Option 3: Red & Gold**
```css
:root {
    --accent: #ef4444;      /* Red */
    --second: #f59e0b;      /* Amber */
}
```

### Custom Background Color
```css
:root {
    --bg: #0f172a;          /* Darker slate */
    --text: #f1f5f9;        /* Lighter text */
}
```

---

## HTML Customization Examples

### Add Age Verification Gate

Add after `<body>` opening tag:

```html
<body>
<div id="age-gate" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:9999; display:flex; align-items:center; justify-content:center;">
  <div style="text-align:center; color:#fff; padding:40px;">
    <h1 style="font-size:2.5rem; margin-bottom:20px;">Age Verification</h1>
    <p style="font-size:1.1rem; margin-bottom:30px;">You must be 21+ to enter this site</p>
    <button onclick="verifyAge()" style="background:#a78bfa; color:#000; border:none; padding:15px 40px; font-size:1.1rem; border-radius:8px; cursor:pointer; font-weight:bold;">
      I am 21+
    </button>
  </div>
</div>

<script>
  function verifyAge() {
    localStorage.setItem('ageVerified', 'true');
    document.getElementById('age-gate').remove();
  }
  
  if (!localStorage.getItem('ageVerified')) {
    // Age gate stays visible
  } else {
    document.getElementById('age-gate').remove();
  }
</script>
```

### Add Instagram Feed

Add to Products section (after category pills):

```html
<div style="margin:40px 0; text-align:center;">
  <h3 style="color:#a78bfa; margin-bottom:20px;">Latest from Instagram</h3>
  <script async src="//www.instagram.com/embed.js"></script>
  <blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/yourshopname/" data-instgrm-version="14"></blockquote>
</div>
```

### Add Google Reviews Widget

Add to Testimonials section:

```html
<!-- Google Reviews Widget -->
<div class="g-review" data-businessid="YOUR_GOOGLE_BUSINESS_ID"></div>
<script src="https://www.googlereviews.io/embed.js"></script>
```

### Add WhatsApp Chat Button

Add before closing `</body>`:

```html
<a href="https://wa.me/15125550123" target="_blank" style="position:fixed; bottom:20px; right:20px; background:#25d366; color:#fff; width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:32px; z-index:999; text-decoration:none;">
  💬
</a>
```

### Add Live Chat (Intercom)

Add before closing `</body>`:

```html
<script>
  window.intercomSettings = {
    api_base: "https://api-iam.intercom.io",
    app_id: "YOUR_INTERCOM_APP_ID"
  };
  
  (function(){var w=window;var ic=w.Intercom;
  if(typeof ic==="function"){ic('reattach_activator');ic('update',intercomSettings);}
  else{var d=document;var i=function(){i.c(arguments)};i.c=function(args){(w.Intercom.q=w.Intercom.q||[]).push(args);};w.Intercom=i;
  if(d.readyState==="complete"){(function(){var s=d.createElement('script');s.src='https://js.intercom-cdn.com/frame.js';d.body.appendChild(s);})();}
  else if(w.attachEvent){w.attachEvent('onload',(function(){(function(){var s=d.createElement('script');s.src='https://js.intercom-cdn.com/frame.js';d.body.appendChild(s);})();}))}
  else{d.addEventListener('DOMContentLoaded',(function(){(function(){var s=d.createElement('script');s.src='https://js.intercom-cdn.com/frame.js';d.body.appendChild(s);})()})}
  }})();
</script>
```

---

## Advanced Customizations

### Add Email Newsletter Signup

Add to footer:

```html
<div style="background:#1a1a1a; padding:40px; margin-top:40px; text-align:center;">
  <h3 style="color:#a78bfa; margin-bottom:20px;">Get Updates & Exclusive Offers</h3>
  <form style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
    <input type="email" placeholder="Your email" style="padding:10px 15px; border:none; border-radius:4px; width:250px;">
    <button type="submit" style="background:#34d399; color:#000; border:none; padding:10px 30px; border-radius:4px; cursor:pointer; font-weight:bold;">Subscribe</button>
  </form>
</div>
```

### Add Photo Gallery

Add custom image gallery:

```html
<div style="margin:40px 0;">
  <h3 style="color:#a78bfa; text-align:center; margin-bottom:30px;">Our Store</h3>
  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:20px;">
    <img src="image1.jpg" alt="Store interior" style="width:100%; border-radius:8px; object-fit:cover; height:250px;">
    <img src="image2.jpg" alt="Product display" style="width:100%; border-radius:8px; object-fit:cover; height:250px;">
    <img src="image3.jpg" alt="Customer lounge" style="width:100%; border-radius:8px; object-fit:cover; height:250px;">
  </div>
</div>
```

### Add Customer Loyalty Program Section

```html
<div style="background:linear-gradient(135deg, #a78bfa, #34d399); padding:40px; margin:40px 0; border-radius:12px; color:#000;">
  <h3 style="font-size:2rem; margin-bottom:20px;">Join Our Loyalty Program</h3>
  <p style="font-size:1.1rem; margin-bottom:20px;">Get rewards on every purchase</p>
  <button style="background:#fff; color:#a78bfa; border:none; padding:12px 30px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:1rem;">
    Sign Up Today
  </button>
</div>
```

---

## Performance Customizations

### Optimize Hero Image
```javascript
// In config.js
heroImage: "https://cdn.example.com/hero-shop.webp",
heroImageAlt: "Premium smoke shop interior",
heroImageSrcset: "https://cdn.example.com/hero-mobile.webp 640w, https://cdn.example.com/hero-desktop.webp 1920w"
```

### Defer Non-Critical Scripts
```html
<!-- In index.html -->
<script src="animations.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/gsap" defer></script>
```

### Preload Critical Resources
```html
<link rel="preload" as="image" href="hero-image.webp">
<link rel="preload" as="script" href="config.js">
```

---

## Testing Customizations

### Test URL Parameters
```bash
# Test with all parameters
http://localhost:3000/?shop=Test%20Shop&city=Test%20City&state=TS&phone=5551234567&rating=4.5&reviews=100
```

### Test Responsive Design
```
Chrome DevTools → F12 → Ctrl+Shift+M
Test on: iPhone, iPad, Galaxy S10, etc.
```

### Test Accessibility
```
Chrome DevTools → Lighthouse → Accessibility
Target: 95+ score
```

---

## Deployment Checklist

- [ ] All config.js business info updated
- [ ] Hero image optimized and uploaded
- [ ] All testimonials added
- [ ] Phone number verified
- [ ] Social media links working
- [ ] Google Maps link accurate
- [ ] Analytics ID configured (if using GA4)
- [ ] Testing on mobile devices
- [ ] Lighthouse scores 90+
- [ ] SSL/HTTPS enabled
- [ ] Custom domain configured

---

## Support

For issues with customizations:
1. Check browser console (F12) for errors
2. Verify JSON syntax in config.js
3. Test with URL parameters first
4. Clear browser cache
5. Check file paths for images

