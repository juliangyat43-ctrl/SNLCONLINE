"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Mobile Navigation Handler - Conservative mobile fixes
// ─────────────────────────────────────────────────────────────────────────────

// ── Mobile Detection ───────────────────────────────────────────────────────────
function isMobile() {
    return window.innerWidth <= 768;
}

// ── Mobile Navigation Enhancement ─────────────────────────────────────────────
function enhanceMobileNavigation() {
    if (!isMobile()) return;
    
    // Add mobile-specific behavior to navigation items
    const navItems = document.querySelectorAll('.s-item, .mnav-item');
    navItems.forEach(item => {
        // Add touch feedback
        item.addEventListener('touchstart', function(e) {
            this.style.transform = 'scale(0.98)';
        });
        
        item.addEventListener('touchend', function(e) {
            this.style.transform = 'scale(1)';
        });
    });


    // If bottom nav exists, we don't force sidebar/hamburger behaviors on mobile.
    const bottomNav = document.getElementById('mobileBottomNav');
    if (bottomNav) return;

    // Ensure sidebar works as slide-out menu on mobile
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.style.position = 'fixed';
        sidebar.style.left = '0';
        sidebar.style.top = '0';
        sidebar.style.height = '100vh';
        sidebar.style.zIndex = '1000';
    }

    // Ensure hamburger menu is visible on mobile
    const toggle = document.getElementById('sidebarToggle');
    if (toggle) {
        toggle.style.display = 'flex';
    }
}

// ── Mobile Touch Optimization ─────────────────────────────────────────────────
function optimizeTouchTargets() {
    if (!isMobile()) return;
    
    // Ensure all buttons have minimum touch target size
    const buttons = document.querySelectorAll('.btn, .s-item, .mnav-item');
    buttons.forEach(btn => {
        const rect = btn.getBoundingClientRect();
        if (rect.height < 44) {
            btn.style.minHeight = '44px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
        }
    });
}

// ── Mobile Table Enhancement ─────────────────────────────────────────────────
function enhanceMobileTables() {
    if (!isMobile()) return;
    
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
        // Ensure tables are scrollable on mobile
        table.style.display = 'block';
        table.style.overflowX = 'auto';
        table.style.whiteSpace = 'nowrap';
    });
}

// ── Mobile Scroll Optimization ─────────────────────────────────────────────────
function optimizeMobileScroll() {
    if (!isMobile()) return;
    
    // Add smooth scrolling to main content
    const mainContent = document.querySelector('.main');
    if (mainContent) {
        mainContent.style.scrollBehavior = 'smooth';
        mainContent.style.webkitOverflowScrolling = 'touch';
    }
}

// ── Mobile Viewport Height Fix ─────────────────────────────────────────────────
function fixMobileViewportHeight() {
    if (!isMobile()) return;
    
    // Fix mobile viewport height issue (especially on iOS)
    const setVh = () => {
        let vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    
    setVh();
    window.addEventListener('resize', setVh);
}

// ── Initialize Mobile Enhancements ───────────────────────────────────────────────
function initMobileEnhancements() {
    if (isMobile()) {
        enhanceMobileNavigation();
        optimizeTouchTargets();
        enhanceMobileTables();
        optimizeMobileScroll();
        fixMobileViewportHeight();
        
        console.log('Mobile enhancements initialized');
    }
}

// ── Handle Resize Events ───────────────────────────────────────────────────────
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initMobileEnhancements();
    }, 250);
});

// ── Initialize on DOM Ready ───────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileEnhancements);
} else {
    initMobileEnhancements();
}