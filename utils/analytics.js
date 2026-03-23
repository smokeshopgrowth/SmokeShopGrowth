'use strict';

/**
 * Analytics & Tracking System
 * ============================
 * Tracks demo site views, form submissions, and conversion events.
 * Provides aggregated statistics and reporting.
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const logger = createLogger('Analytics');
const ANALYTICS_DIR = path.join(process.cwd(), 'data', 'analytics');
const EVENTS_FILE = path.join(ANALYTICS_DIR, 'events.jsonl');

// Ensure analytics directory exists
try {
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
} catch (e) {
    logger.warn('Could not create analytics directory', { error: e.message });
}

// Event types
const EVENT_TYPES = {
    PAGE_VIEW: 'page_view',
    FORM_SUBMIT: 'form_submit',
    BUTTON_CLICK: 'button_click',
    SCROLL_DEPTH: 'scroll_depth',
    TIME_ON_PAGE: 'time_on_page',
    EXIT_INTENT: 'exit_intent',
    CONVERSION: 'conversion',
    PRICING_VIEW: 'pricing_view',
    CTA_CLICK: 'cta_click',
};

/**
 * Track an analytics event
 */
function trackEvent(event) {
    const eventData = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        ...event,
    };

    try {
        fs.appendFileSync(EVENTS_FILE, JSON.stringify(eventData) + '\n');
        logger.debug('Event tracked', { type: event.type, demo_id: event.demo_id });
    } catch (e) {
        logger.warn('Failed to write analytics event', { error: e.message });
    }

    return eventData;
}

/**
 * Track a page view
 */
function trackPageView(demoId, data = {}) {
    return trackEvent({
        type: EVENT_TYPES.PAGE_VIEW,
        demo_id: demoId,
        url: data.url || '',
        referrer: data.referrer || '',
        user_agent: data.userAgent || '',
        ip: data.ip || '',
        session_id: data.sessionId || '',
    });
}

/**
 * Track a form submission
 */
function trackFormSubmit(demoId, data = {}) {
    return trackEvent({
        type: EVENT_TYPES.FORM_SUBMIT,
        demo_id: demoId,
        form_name: data.formName || 'contact',
        fields: data.fields || {},
    });
}

/**
 * Track a conversion (purchase)
 */
function trackConversion(demoId, data = {}) {
    return trackEvent({
        type: EVENT_TYPES.CONVERSION,
        demo_id: demoId,
        tier: data.tier || '',
        amount: data.amount || 0,
        stripe_session_id: data.stripeSessionId || '',
    });
}

/**
 * Track a button/CTA click
 */
function trackClick(demoId, data = {}) {
    return trackEvent({
        type: EVENT_TYPES.CTA_CLICK,
        demo_id: demoId,
        button_id: data.buttonId || '',
        button_text: data.buttonText || '',
        href: data.href || '',
    });
}

/**
 * Read all events from file
 */
function readAllEvents() {
    const events = [];
    
    try {
        if (fs.existsSync(EVENTS_FILE)) {
            const content = fs.readFileSync(EVENTS_FILE, 'utf8');
            const lines = content.trim().split('\n').filter(Boolean);
            
            for (const line of lines) {
                try {
                    events.push(JSON.parse(line));
                } catch (e) {
                    // Skip malformed lines
                }
            }
        }
    } catch (e) {
        logger.warn('Failed to read analytics events', { error: e.message });
    }

    return events;
}

/**
 * Get events for a specific demo
 */
function getEventsByDemo(demoId) {
    const allEvents = readAllEvents();
    return allEvents.filter(e => e.demo_id === demoId);
}

/**
 * Get events within a date range
 */
function getEventsByDateRange(startDate, endDate) {
    const allEvents = readAllEvents();
    const start = new Date(startDate);
    const end = new Date(endDate);

    return allEvents.filter(e => {
        const eventDate = new Date(e.timestamp);
        return eventDate >= start && eventDate <= end;
    });
}

/**
 * Get aggregated statistics for a demo
 */
function getDemoStats(demoId) {
    const events = getEventsByDemo(demoId);

    const pageViews = events.filter(e => e.type === EVENT_TYPES.PAGE_VIEW).length;
    const formSubmits = events.filter(e => e.type === EVENT_TYPES.FORM_SUBMIT).length;
    const conversions = events.filter(e => e.type === EVENT_TYPES.CONVERSION).length;
    const ctaClicks = events.filter(e => e.type === EVENT_TYPES.CTA_CLICK).length;

    // Calculate conversion rate
    const conversionRate = pageViews > 0 ? ((conversions / pageViews) * 100).toFixed(2) : 0;

    // Get unique sessions
    const uniqueSessions = new Set(events.map(e => e.session_id).filter(Boolean)).size;

    // Get bounce rate (single page view sessions)
    const sessionViews = {};
    events.forEach(e => {
        if (e.session_id && e.type === EVENT_TYPES.PAGE_VIEW) {
            sessionViews[e.session_id] = (sessionViews[e.session_id] || 0) + 1;
        }
    });
    const bouncedSessions = Object.values(sessionViews).filter(v => v === 1).length;
    const bounceRate = uniqueSessions > 0 ? ((bouncedSessions / uniqueSessions) * 100).toFixed(2) : 0;

    // Calculate total revenue
    const revenue = events
        .filter(e => e.type === EVENT_TYPES.CONVERSION)
        .reduce((sum, e) => sum + (e.amount || 0), 0);

    // Get daily breakdown
    const dailyViews = {};
    events
        .filter(e => e.type === EVENT_TYPES.PAGE_VIEW)
        .forEach(e => {
            const day = e.timestamp.split('T')[0];
            dailyViews[day] = (dailyViews[day] || 0) + 1;
        });

    // Get top referrers
    const referrers = {};
    events
        .filter(e => e.type === EVENT_TYPES.PAGE_VIEW && e.referrer)
        .forEach(e => {
            try {
                const host = new URL(e.referrer).hostname;
                referrers[host] = (referrers[host] || 0) + 1;
            } catch {
                // Invalid URL
            }
        });

    return {
        demoId,
        pageViews,
        uniqueVisitors: uniqueSessions,
        formSubmits,
        conversions,
        ctaClicks,
        conversionRate: parseFloat(conversionRate),
        bounceRate: parseFloat(bounceRate),
        revenue,
        dailyViews,
        topReferrers: Object.entries(referrers)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([host, count]) => ({ host, count })),
    };
}

/**
 * Get overall platform statistics
 */
function getPlatformStats(days = 30) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = getEventsByDateRange(startDate, endDate);

    // Aggregate by demo
    const demoStats = {};
    events.forEach(e => {
        if (!e.demo_id) return;
        if (!demoStats[e.demo_id]) {
            demoStats[e.demo_id] = {
                pageViews: 0,
                formSubmits: 0,
                conversions: 0,
                revenue: 0,
            };
        }

        if (e.type === EVENT_TYPES.PAGE_VIEW) demoStats[e.demo_id].pageViews++;
        if (e.type === EVENT_TYPES.FORM_SUBMIT) demoStats[e.demo_id].formSubmits++;
        if (e.type === EVENT_TYPES.CONVERSION) {
            demoStats[e.demo_id].conversions++;
            demoStats[e.demo_id].revenue += e.amount || 0;
        }
    });

    // Top performing demos
    const topDemos = Object.entries(demoStats)
        .sort((a, b) => b[1].pageViews - a[1].pageViews)
        .slice(0, 10)
        .map(([demoId, stats]) => ({ demoId, ...stats }));

    // Daily breakdown
    const dailyStats = {};
    events.forEach(e => {
        const day = e.timestamp.split('T')[0];
        if (!dailyStats[day]) {
            dailyStats[day] = { pageViews: 0, conversions: 0, revenue: 0 };
        }
        if (e.type === EVENT_TYPES.PAGE_VIEW) dailyStats[day].pageViews++;
        if (e.type === EVENT_TYPES.CONVERSION) {
            dailyStats[day].conversions++;
            dailyStats[day].revenue += e.amount || 0;
        }
    });

    // Totals
    const totalPageViews = events.filter(e => e.type === EVENT_TYPES.PAGE_VIEW).length;
    const totalFormSubmits = events.filter(e => e.type === EVENT_TYPES.FORM_SUBMIT).length;
    const totalConversions = events.filter(e => e.type === EVENT_TYPES.CONVERSION).length;
    const totalRevenue = events
        .filter(e => e.type === EVENT_TYPES.CONVERSION)
        .reduce((sum, e) => sum + (e.amount || 0), 0);

    return {
        period: `${days} days`,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totals: {
            pageViews: totalPageViews,
            formSubmits: totalFormSubmits,
            conversions: totalConversions,
            revenue: totalRevenue,
            conversionRate: totalPageViews > 0
                ? ((totalConversions / totalPageViews) * 100).toFixed(2)
                : 0,
        },
        topDemos,
        dailyStats: Object.entries(dailyStats)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, stats]) => ({ date, ...stats })),
    };
}

/**
 * Get A/B test results for a demo
 */
function getABTestResults(demoId, variants = ['A', 'B']) {
    const events = getEventsByDemo(demoId);
    
    const results = {};
    variants.forEach(v => {
        results[v] = {
            pageViews: 0,
            formSubmits: 0,
            conversions: 0,
        };
    });

    events.forEach(e => {
        const variant = e.variant || 'A';
        if (!results[variant]) return;

        if (e.type === EVENT_TYPES.PAGE_VIEW) results[variant].pageViews++;
        if (e.type === EVENT_TYPES.FORM_SUBMIT) results[variant].formSubmits++;
        if (e.type === EVENT_TYPES.CONVERSION) results[variant].conversions++;
    });

    // Calculate conversion rates
    Object.keys(results).forEach(v => {
        results[v].conversionRate = results[v].pageViews > 0
            ? ((results[v].conversions / results[v].pageViews) * 100).toFixed(2)
            : 0;
    });

    // Determine winner
    let winner = null;
    let maxRate = 0;
    Object.entries(results).forEach(([v, stats]) => {
        const rate = parseFloat(stats.conversionRate);
        if (rate > maxRate) {
            maxRate = rate;
            winner = v;
        }
    });

    return {
        demoId,
        variants: results,
        winner,
        confidence: 'N/A', // Would need statistical significance calculation
    };
}

/**
 * Express middleware for tracking demo page views
 */
function trackingMiddleware(req, res, next) {
    // Only track demo pages
    if (req.path.startsWith('/demos/') && req.method === 'GET') {
        const demoId = req.path.split('/demos/')[1]?.split('/')[0];
        
        if (demoId) {
            trackPageView(demoId, {
                url: req.originalUrl,
                referrer: req.get('referer') || '',
                userAgent: req.get('user-agent') || '',
                ip: req.ip,
                sessionId: req.sessionID || req.cookies?.session_id || '',
            });
        }
    }

    next();
}

/**
 * API endpoint handler for tracking events
 */
function handleTrackEvent(req, res) {
    const { type, demo_id, ...data } = req.body;

    if (!type || !demo_id) {
        return res.status(400).json({ error: 'type and demo_id are required' });
    }

    const event = trackEvent({
        type,
        demo_id,
        ...data,
        ip: req.ip,
        user_agent: req.get('user-agent'),
    });

    res.json({ ok: true, eventId: event.id });
}

module.exports = {
    EVENT_TYPES,
    trackEvent,
    trackPageView,
    trackFormSubmit,
    trackConversion,
    trackClick,
    readAllEvents,
    getEventsByDemo,
    getEventsByDateRange,
    getDemoStats,
    getPlatformStats,
    getABTestResults,
    trackingMiddleware,
    handleTrackEvent,
};
