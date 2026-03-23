'use strict';

/**
 * Lead Scoring System
 * ====================
 * Calculates a quality score (0-100) for each lead based on various factors:
 * - Website quality (presence, mobile-friendly, SSL, speed)
 * - Social media presence (Instagram, Facebook, etc.)
 * - Business information completeness
 * - Reviews and ratings
 * - Contact information availability
 */

const { createLogger } = require('./logger');
const logger = createLogger('LeadScoring');

// Scoring weights (must sum to 100)
const WEIGHTS = {
    website: 30,       // Website quality
    social: 20,        // Social media presence
    reviews: 20,       // Google reviews/rating
    contact: 15,       // Contact info availability
    business: 15,      // Business info completeness
};

// Score thresholds
const THRESHOLDS = {
    HOT: 70,           // Hot lead - ready to convert
    WARM: 50,          // Warm lead - needs nurturing
    COLD: 0,           // Cold lead - needs more work
};

/**
 * Calculate website quality score (0-100)
 */
function scoreWebsite(lead) {
    let score = 0;
    const maxScore = 100;

    // Has website at all
    if (lead.website) {
        score += 30;

        // Uses HTTPS
        if (lead.website.startsWith('https://')) {
            score += 15;
        }

        // Has SSL certificate (implied by https)
        if (lead.has_ssl || lead.website.startsWith('https://')) {
            score += 10;
        }

        // Mobile friendly
        if (lead.is_mobile_friendly !== false) {
            score += 15;
        }

        // Fast load time (under 3 seconds)
        if (lead.load_time && lead.load_time < 3) {
            score += 15;
        } else if (lead.load_time && lead.load_time < 5) {
            score += 10;
        }

        // Has contact form
        if (lead.has_contact_form) {
            score += 5;
        }

        // Has e-commerce
        if (lead.has_ecommerce) {
            score += 10;
        }
    }

    return Math.min(score, maxScore);
}

/**
 * Calculate social media presence score (0-100)
 */
function scoreSocial(lead) {
    let score = 0;
    const maxScore = 100;

    // Instagram presence
    if (lead.instagram) {
        score += 30;
        
        // Has significant following
        if (lead.instagram_followers) {
            if (lead.instagram_followers >= 10000) score += 20;
            else if (lead.instagram_followers >= 1000) score += 15;
            else if (lead.instagram_followers >= 100) score += 10;
        }
    }

    // Facebook presence
    if (lead.facebook) {
        score += 20;
        
        if (lead.facebook_likes) {
            if (lead.facebook_likes >= 1000) score += 10;
            else if (lead.facebook_likes >= 100) score += 5;
        }
    }

    // Google Business Profile
    if (lead.google_business_url || lead.place_id) {
        score += 20;
    }

    // Yelp presence
    if (lead.yelp_url || lead.yelp_rating) {
        score += 10;
    }

    return Math.min(score, maxScore);
}

/**
 * Calculate reviews and rating score (0-100)
 */
function scoreReviews(lead) {
    let score = 0;
    const maxScore = 100;

    // Google rating (out of 5)
    const rating = parseFloat(lead.rating) || 0;
    if (rating >= 4.5) {
        score += 40;
    } else if (rating >= 4.0) {
        score += 30;
    } else if (rating >= 3.5) {
        score += 20;
    } else if (rating >= 3.0) {
        score += 10;
    }

    // Number of reviews
    const reviewCount = parseInt(lead.review_count || lead.reviews) || 0;
    if (reviewCount >= 100) {
        score += 40;
    } else if (reviewCount >= 50) {
        score += 30;
    } else if (reviewCount >= 20) {
        score += 20;
    } else if (reviewCount >= 10) {
        score += 15;
    } else if (reviewCount >= 5) {
        score += 10;
    } else if (reviewCount > 0) {
        score += 5;
    }

    // Recency of reviews (if available)
    if (lead.last_review_date) {
        const daysSinceLastReview = (Date.now() - new Date(lead.last_review_date)) / (1000 * 60 * 60 * 24);
        if (daysSinceLastReview < 30) {
            score += 20;
        } else if (daysSinceLastReview < 90) {
            score += 15;
        } else if (daysSinceLastReview < 180) {
            score += 10;
        }
    }

    return Math.min(score, maxScore);
}

/**
 * Calculate contact information score (0-100)
 */
function scoreContact(lead) {
    let score = 0;
    const maxScore = 100;

    // Has phone number
    if (lead.phone) {
        score += 40;

        // Phone is formatted (indicates it's valid)
        if (/^\+?1?\d{10,}$/.test(lead.phone.replace(/\D/g, ''))) {
            score += 10;
        }
    }

    // Has email
    if (lead.email) {
        score += 30;

        // Is business email (not gmail, etc.)
        if (lead.email && !/@(gmail|yahoo|hotmail|outlook)\./i.test(lead.email)) {
            score += 10;
        }
    }

    // Has full address
    if (lead.address && lead.address.length > 20) {
        score += 10;
    }

    return Math.min(score, maxScore);
}

/**
 * Calculate business information completeness score (0-100)
 */
function scoreBusiness(lead) {
    let score = 0;
    const maxScore = 100;

    // Has business name
    if (lead.name || lead.business_name) {
        score += 20;
    }

    // Has address
    if (lead.address) {
        score += 15;
    }

    // Has city
    if (lead.city) {
        score += 10;
    }

    // Has hours
    if (lead.hours || lead.opening_hours) {
        score += 15;
    }

    // Has categories/type
    if (lead.categories || lead.biz_type || lead.type) {
        score += 10;
    }

    // Has place_id (verified business)
    if (lead.place_id) {
        score += 20;
    }

    // Has photos
    if (lead.photos_count > 0 || lead.has_photos) {
        score += 10;
    }

    return Math.min(score, maxScore);
}

/**
 * Calculate the overall lead score (0-100)
 */
function calculateScore(lead) {
    const websiteScore = scoreWebsite(lead);
    const socialScore = scoreSocial(lead);
    const reviewsScore = scoreReviews(lead);
    const contactScore = scoreContact(lead);
    const businessScore = scoreBusiness(lead);

    // Weighted average
    const totalScore = Math.round(
        (websiteScore * WEIGHTS.website +
         socialScore * WEIGHTS.social +
         reviewsScore * WEIGHTS.reviews +
         contactScore * WEIGHTS.contact +
         businessScore * WEIGHTS.business) / 100
    );

    return {
        total: totalScore,
        breakdown: {
            website: websiteScore,
            social: socialScore,
            reviews: reviewsScore,
            contact: contactScore,
            business: businessScore,
        },
        category: getScoreCategory(totalScore),
    };
}

/**
 * Get score category label
 */
function getScoreCategory(score) {
    if (score >= THRESHOLDS.HOT) return 'hot';
    if (score >= THRESHOLDS.WARM) return 'warm';
    return 'cold';
}

/**
 * Calculate priority rank for sorting leads
 * Higher priority = better lead
 */
function calculatePriority(lead) {
    const score = calculateScore(lead);
    
    // Base priority is the score
    let priority = score.total;

    // Boost for recency (if created recently)
    if (lead.created_at) {
        const daysOld = (Date.now() - new Date(lead.created_at)) / (1000 * 60 * 60 * 24);
        if (daysOld < 1) priority += 20;
        else if (daysOld < 7) priority += 10;
        else if (daysOld < 30) priority += 5;
    }

    // Boost for high rating
    if (parseFloat(lead.rating) >= 4.5) {
        priority += 10;
    }

    // Penalty for no website (they need our services more but might be harder to reach)
    // Actually, this makes them a BETTER prospect for us
    if (!lead.website) {
        priority += 15; // They need a website!
    }

    // Boost if they have many reviews (established business)
    if (parseInt(lead.review_count || lead.reviews) >= 50) {
        priority += 10;
    }

    return priority;
}

/**
 * Score multiple leads and sort by priority
 */
function scoreAndRankLeads(leads) {
    const scoredLeads = leads.map(lead => {
        const scoreResult = calculateScore(lead);
        const priority = calculatePriority(lead);
        
        return {
            ...lead,
            score: scoreResult.total,
            score_breakdown: scoreResult.breakdown,
            score_category: scoreResult.category,
            priority,
        };
    });

    // Sort by priority (descending)
    scoredLeads.sort((a, b) => b.priority - a.priority);

    return scoredLeads;
}

/**
 * Get scoring recommendations for a lead
 */
function getScoringRecommendations(lead) {
    const score = calculateScore(lead);
    const recommendations = [];

    if (score.breakdown.website < 50) {
        if (!lead.website) {
            recommendations.push({
                priority: 'high',
                area: 'website',
                message: 'No website detected - perfect candidate for our services',
            });
        } else if (!lead.website.startsWith('https://')) {
            recommendations.push({
                priority: 'medium',
                area: 'website',
                message: 'Website lacks HTTPS - security concern to address',
            });
        }
    }

    if (score.breakdown.social < 30) {
        recommendations.push({
            priority: 'medium',
            area: 'social',
            message: 'Limited social media presence - opportunity to build online community',
        });
    }

    if (score.breakdown.reviews < 40) {
        recommendations.push({
            priority: 'low',
            area: 'reviews',
            message: 'Could benefit from more customer reviews',
        });
    }

    if (score.breakdown.contact < 50) {
        recommendations.push({
            priority: 'high',
            area: 'contact',
            message: 'Missing contact information - may need additional research',
        });
    }

    return {
        score,
        recommendations,
        summary: recommendations.length > 0
            ? `${recommendations.length} area(s) to focus on for this lead`
            : 'Lead is well-qualified across all areas',
    };
}

module.exports = {
    calculateScore,
    calculatePriority,
    scoreAndRankLeads,
    getScoringRecommendations,
    scoreWebsite,
    scoreSocial,
    scoreReviews,
    scoreContact,
    scoreBusiness,
    getScoreCategory,
    WEIGHTS,
    THRESHOLDS,
};
