"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Modern Mobile Navigation Handler
// ─────────────────────────────────────────────────────────────────────────────

function isMobile() {
    return window.innerWidth <= 768;
}

/**
 * Enhanced touch feedback and navigation behaviors
 */
function enhanceMobileNavigation() {
    if (!isMobile()) return;
    
    const navItems = document.querySelectorAll('.s-item, .mnav-item');
    navItems.forEach(item => {
        item.addEventListener('touchstart', function() {
            this.classList.add('touch-active');
        }, { passive: true });
        
        item.addEventListener('touchend', function() {
            this.classList.remove('touch-active');
        }, { passive: true });
    });

    // Handle scroll to top on page navigation
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.classList.contains('page') && target.classList.contains('active')) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }
        });
    });

    document.querySelectorAll('.page').forEach(page => {
        observer.observe(page, { attributes: true });
    });
}

/**
 * Mobile-specific UI tweaks
 */
function initMobileEnhancements() {
    if (isMobile()) {
        enhanceMobileNavigation();
        
        // Add specific CSS for touch feedback if not present
        if (!document.getElementById('mobile-touch-style')) {
            const style = document.createElement('style');
            style.id = 'mobile-touch-style';
            style.innerHTML = `
                .touch-active { background-color: rgba(0,0,0,0.05) !important; transform: scale(0.96); transition: transform 0.1s; }
                .mnav-item.touch-active { background-color: var(--maroon-soft) !important; }
            `;
            document.head.appendChild(style);
        }

        console.log('Modern mobile enhancements initialized');
    }
}

// Re-initialize on significant resize
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(initMobileEnhancements, 250);
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileEnhancements);
} else {
    initMobileEnhancements();
}
