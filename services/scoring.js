'use strict';

/**
 * Lead Scoring Service
 * Calculates a quality score for leads based on multiple factors
 */

const { createLogger } = require('../utils/logger');
const logger = createLogger('Scoring');

/**
 * Scoring weights configuration
 */
const WEIGHTS = {
    website: {
        hasWebsite: 10,
        hasSsl: 8,
        mobileResponsive: 12,
        hasOnlineMenu: 5,
        loadTime: 10, // Based on performance
    },
    social: {
        hasInstagram: 8,
        hasFacebook: 6,
        hasGoogleReviews: 10,
        reviewCount: 10, // Scaled
        reviewRating: 10, // Scaled
    },
    business: {
        hasPhone: 5,
        hasEmail: 5,
        hasAddress: 3,
        hasHours: 4,
    },
    engagement: {
        recentActivity: 10, // Social posts, reviews
        responseRate: 8, // Replies to reviews
    },
};

/**
 * Calculate website quality score (0-40 points)
 */
function scoreWebsite(lead) {
    let score = 0;

    // Has website
    if (lead.website && lead.website !== 'N/A' && lead.website !== '') {
        score += WEIGHTS.website.hasWebsite;
    }

    // SSL/HTTPS
    if (lead.website?.startsWith('https://')) {
        score += WEIGHTS.website.hasSsl;
    }

    // Mobile responsive (from audit)
    if (lead.mobile_score && parseInt(lead.mobile_score) >= 70) {
        score += WEIGHTS.website.mobileResponsive;
    } else if (lead.mobile_friendly === 'true' || lead.mobile_friendly === true) {
        score += WEIGHTS.website.mobileResponsive;
    }

    // Performance (load time)
    if (lead.performance_score) {
        const perf = parseInt(lead.performance_score);
        if (perf >= 80) score += WEIGHTS.website.loadTime;
        else if (perf >= 50) score += WEIGHTS.website.loadTime * 0.5;
    }

    // Online menu/catalog
    if (lead.has_menu === 'true' || lead.has_online_store === 'true') {
        score += WEIGHTS.website.hasOnlineMenu;
    }

    return score;
}

/**
 * Calculate social presence score (0-44 points)
 */
function scoreSocial(lead) {
    let score = 0;

    // Instagram
    if (lead.instagram && lead.instagram !== 'N/A' && lead.instagram !== '') {
        score += WEIGHTS.social.hasInstagram;
    }

    // Facebook
    if (lead.facebook && lead.facebook !== 'N/A' && lead.facebook !== '') {
        score += WEIGHTS.social.hasFacebook;
    }

    // Google Reviews
    if (lead.google_reviews || lead.reviews_count) {
        score += WEIGHTS.social.hasGoogleReviews;
    }

    // Review count (max 10 points for 50+ reviews)
    const reviewCount = parseInt(lead.reviews_count || lead.google_reviews) || 0;
    if (reviewCount >= 50) {
        score += WEIGHTS.social.reviewCount;
    } else if (reviewCount >= 20) {
        score += WEIGHTS.social.reviewCount * 0.7;
    } else if (reviewCount >= 5) {
        score += WEIGHTS.social.reviewCount * 0.4;
    } else if (reviewCount > 0) {
        score += WEIGHTS.social.reviewCount * 0.2;
    }

    // Review rating (max 10 points for 4.5+ rating)
    const rating = parseFloat(lead.rating || lead.google_rating) || 0;
    if (rating >= 4.5) {
        score += WEIGHTS.social.reviewRating;
    } else if (rating >= 4.0) {
        score += WEIGHTS.social.reviewRating * 0.8;
    } else if (rating >= 3.5) {
        score += WEIGHTS.social.reviewRating * 0.5;
    } else if (rating > 0) {
        score += WEIGHTS.social.reviewRating * 0.2;
    }

    return score;
}

/**
 * Calculate business info completeness score (0-17 points)
 */
function scoreBusinessInfo(lead) {
    let score = 0;

    if (lead.phone && lead.phone !== 'N/A' && lead.phone !== '') {
        score += WEIGHTS.business.hasPhone;
    }

    if (lead.email && lead.email !== 'N/A' && lead.email !== '') {
        score += WEIGHTS.business.hasEmail;
    }

    if (lead.address && lead.address !== 'N/A' && lead.address !== '') {
        score += WEIGHTS.business.hasAddress;
    }

    if (lead.hours && lead.hours !== 'N/A' && lead.hours !== '') {
        score += WEIGHTS.business.hasHours;
    }

    return score;
}

/**
 * Calculate total lead score
 * @param {Object} lead - Lead data object
 * @returns {Object} Score breakdown and total
 */
function calculateLeadScore(lead) {
    const websiteScore = scoreWebsite(lead);
    const socialScore = scoreSocial(lead);
    const businessScore = scoreBusinessInfo(lead);

    // Total possible: 40 + 44 + 17 = 101, normalize to 100
    const rawTotal = websiteScore + socialScore + businessScore;
    const normalizedScore = Math.min(100, Math.round(rawTotal));

    // Determine tier
    let tier = 'low';
    if (normalizedScore >= 70) tier = 'high';
    else if (normalizedScore >= 40) tier = 'medium';

    // Determine priority based on opportunity (lower scores = more room for improvement)
    let priority = 'low';
    if (normalizedScore >= 30 && normalizedScore < 70) {
        priority = 'high'; // Good opportunity - some presence but room to grow
    } else if (normalizedScore < 30) {
        priority = 'medium'; // May need more convincing
    }

    return {
        score: normalizedScore,
        tier,
        priority,
        breakdown: {
            website: Math.round(websiteScore),
            social: Math.round(socialScore),
            business: Math.round(businessScore),
        },
        recommendations: generateRecommendations(lead, websiteScore, socialScore, businessScore),
    };
}

/**
 * Generate improvement recommendations
 */
function generateRecommendations(lead, websiteScore, socialScore, businessScore) {
    const recommendations = [];

    // Website recommendations
    if (!lead.website || lead.website === 'N/A') {
        recommendations.push({
            category: 'website',
            priority: 'high',
            message: 'No website found - great opportunity for a new build',
        });
    } else {
        if (!lead.website?.startsWith('https://')) {
            recommendations.push({
                category: 'website',
                priority: 'high',
                message: 'Website lacks SSL certificate',
            });
        }
        if (websiteScore < 20) {
            recommendations.push({
                category: 'website',
                priority: 'medium',
                message: 'Website needs performance and mobile optimization',
            });
        }
    }

    // Social recommendations
    if (!lead.instagram || lead.instagram === 'N/A') {
        recommendations.push({
            category: 'social',
            priority: 'medium',
            message: 'No Instagram presence - missing local discovery opportunity',
        });
    }

    const reviewCount = parseInt(lead.reviews_count || lead.google_reviews) || 0;
    if (reviewCount < 10) {
        recommendations.push({
            category: 'social',
            priority: 'medium',
            message: 'Low Google review count - needs review generation strategy',
        });
    }

    // Business info recommendations
    if (!lead.email || lead.email === 'N/A') {
        recommendations.push({
            category: 'business',
            priority: 'low',
            message: 'No email found - may need phone outreach',
        });
    }

    return recommendations.slice(0, 3); // Top 3 recommendations
}

/**
 * Batch score multiple leads
 */
function scoreLeads(leads) {
    logger.info(`Scoring ${leads.length} leads`);
    
    return leads.map(lead => {
        const scoring = calculateLeadScore(lead);
        return {
            ...lead,
            score: scoring.score,
            score_tier: scoring.tier,
            score_priority: scoring.priority,
            score_breakdown: JSON.stringify(scoring.breakdown),
            recommendations: JSON.stringify(scoring.recommendations),
        };
    });
}

/**
 * Get score distribution for analytics
 */
function getScoreDistribution(leads) {
    const distribution = {
        high: 0,
        medium: 0,
        low: 0,
    };

    leads.forEach(lead => {
        const score = lead.score || calculateLeadScore(lead).score;
        if (score >= 70) distribution.high++;
        else if (score >= 40) distribution.medium++;
        else distribution.low++;
    });

    return distribution;
}

module.exports = {
    calculateLeadScore,
    scoreLeads,
    getScoreDistribution,
    WEIGHTS,
};
