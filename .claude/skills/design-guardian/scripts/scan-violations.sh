#!/bin/bash
# SHAPE Design System Violation Scanner (v2 — Comprehensive)
# Usage: ./scan-violations.sh [file-or-directory]
# Scans TSX/JSX files for design system violations across ALL categories.

TARGET="${1:-.}"
VIOLATIONS=0
S1_COUNT=0
S2_COUNT=0
S3_COUNT=0

RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

EXCLUDE="--exclude-dir=node_modules --exclude-dir=.git --exclude=*.test.* --exclude=*.spec.* --exclude=SKILL.md --exclude=design-rules.md"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${BOLD} SHAPE Design System Violation Scanner v2${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Scanning: ${BOLD}$TARGET${NC}"
echo ""

count_hits() {
  local hits="$1"
  if [ -n "$hits" ]; then
    echo "$hits" | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

print_section() {
  local label="$1"
  local hits="$2"
  local count
  count=$(count_hits "$hits")
  if [ "$count" -gt 0 ]; then
    echo -e "  $label ${RED}($count)${NC}"
    echo "$hits" | head -20
    if [ "$count" -gt 20 ]; then
      echo "  ... and $((count - 20)) more"
    fi
    echo ""
  fi
}

# ═══════════════════════════════════════════════════
# S1: CRITICAL VIOLATIONS
# ═══════════════════════════════════════════════════

echo -e "${RED}${BOLD}═══ S1: CRITICAL ═══${NC}"
echo ""

# 1. Shadows (except approved glow patterns)
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '\bshadow-(sm|md|lg|xl|2xl)\b' "$TARGET" 2>/dev/null | grep -v 'design-system/tokens' | grep -v 'enforcePatterns')
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Drop shadows (forbidden)" "$HITS"

# 2. Hardcoded bg colors
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E 'bg-\[#[0-9a-fA-F]{3,8}\]' "$TARGET" 2>/dev/null | grep -v 'design-system/' | grep -v 'tailwind.config' | grep -v 'index.css')
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Hardcoded bg colors" "$HITS"

# 3. Hardcoded text colors
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E 'text-\[#[0-9a-fA-F]{3,8}\]' "$TARGET" 2>/dev/null | grep -v 'design-system/' | grep -v 'tailwind.config')
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Hardcoded text colors" "$HITS"

# 4. Hardcoded ring/border colors
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '(ring|border)-\[#[0-9a-fA-F]{3,8}\]' "$TARGET" 2>/dev/null | grep -v 'design-system/' | grep -v 'tailwind.config')
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Hardcoded ring/border colors" "$HITS"

# 5. Amber on buttons (bg-d2-amber, bg-amber-*, bg-yellow-* near button context)
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '(bg-d2-amber|bg-amber-|bg-yellow-).*(btn|button|Button|onClick)|(btn|button|Button|onClick).*(bg-d2-amber|bg-amber-|bg-yellow-)' "$TARGET" 2>/dev/null)
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Amber on buttons" "$HITS"

# 6. variant="accent" on buttons
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E 'variant\s*=\s*["\x27]accent["\x27]' "$TARGET" 2>/dev/null)
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "variant=\"accent\" on buttons" "$HITS"

# 7. Hardcoded amber hex (#F2B71A) in inline styles (should use var(--accent-color))
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E "style.*#F2B71A|style.*#f2b71a|backgroundColor.*['\"]#F2B71A" "$TARGET" 2>/dev/null | grep -v 'tokens.ts' | grep -v 'design-system/')
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Hardcoded #F2B71A in inline styles" "$HITS"

# 8. Wrong page padding (p-8, px-6, pt-6 on page-level containers)
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E 'className="[^"]*\b(p-8|px-6|pt-6|pb-6|p-6)\b' "$TARGET" 2>/dev/null | grep -iv 'card\|modal\|dialog\|dropdown\|popover\|tooltip\|menu')
C=$(count_hits "$HITS"); S1_COUNT=$((S1_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Potentially wrong page padding (not 48px)" "$HITS"

echo ""

# ═══════════════════════════════════════════════════
# S2: IMPORTANT VIOLATIONS
# ═══════════════════════════════════════════════════

echo -e "${YELLOW}${BOLD}═══ S2: IMPORTANT ═══${NC}"
echo ""

# 9. Badge usage (non-critical)
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '<Badge\b' "$TARGET" 2>/dev/null | grep -v 'design-system/Badge' | grep -v 'import.*Badge')
C=$(count_hits "$HITS"); S2_COUNT=$((S2_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Badge usage (prefer StatusText)" "$HITS"

# 10. Amber on icons
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '\btext-(d2-amber|amber-[0-9]|yellow-[0-9])' "$TARGET" 2>/dev/null | grep -v 'design-system/' | grep -v 'tokens')
C=$(count_hits "$HITS"); S2_COUNT=$((S2_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Amber/yellow text (likely icon or badge)" "$HITS"

# 11. Non-standard border-radius
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '\brounded-(xl|2xl|3xl)\b' "$TARGET" 2>/dev/null | grep -v 'design-system/')
C=$(count_hits "$HITS"); S2_COUNT=$((S2_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Non-standard border-radius (xl/2xl/3xl)" "$HITS"

# 12. Non-standard transition durations
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '\bduration-(50|75|100|400|500|700|1000)\b' "$TARGET" 2>/dev/null)
C=$(count_hits "$HITS"); S2_COUNT=$((S2_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Non-standard transition durations" "$HITS"

# 13. Container/card borders (border on cards/panels)
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -B1 -A1 -E '<Card|<Panel|<Container|<Dialog' "$TARGET" 2>/dev/null | grep -E '\bborder\b' | grep -v 'border-b ' | grep -v 'border-white' | grep -v 'border-none' | grep -v 'border-transparent' | grep -v 'border-0')
C=$(count_hits "$HITS"); S2_COUNT=$((S2_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Container/card borders" "$HITS"

# 14. Hardcoded amber classes on non-decorative elements
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '\bbg-amber-[0-9]+|bg-yellow-[0-9]+' "$TARGET" 2>/dev/null | grep -v 'design-system/')
C=$(count_hits "$HITS"); S2_COUNT=$((S2_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "bg-amber-*/bg-yellow-* usage" "$HITS"

# 15. Hardcoded amber from- classes (gradients)
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '\bfrom-amber-|to-amber-|via-amber-|from-yellow-|to-yellow-|via-yellow-' "$TARGET" 2>/dev/null | grep -v 'design-system/')
C=$(count_hits "$HITS"); S2_COUNT=$((S2_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Amber/yellow gradient classes" "$HITS"

echo ""

# ═══════════════════════════════════════════════════
# S3: ADVISORY
# ═══════════════════════════════════════════════════

echo -e "${CYAN}${BOLD}═══ S3: ADVISORY ═══${NC}"
echo ""

# 16. Missing overscroll-behavior on scroll containers
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '\boverflow-(auto|y-auto|x-auto)\b' "$TARGET" 2>/dev/null | grep -v 'overscroll')
C=$(count_hits "$HITS"); S3_COUNT=$((S3_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Scroll containers missing overscroll-contain" "$HITS"

# 17. Potential missing design system component usage
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E '<table\b|<th\b|<td\b' "$TARGET" 2>/dev/null | grep -v 'design-system/' | grep -v 'DataTable')
C=$(count_hits "$HITS"); S3_COUNT=$((S3_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Raw <table> elements (consider DataTable)" "$HITS"

# 18. box-shadow in inline styles (non-glow)
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E "style.*boxShadow|style.*box-shadow" "$TARGET" 2>/dev/null | grep -v 'glow\|inset.*rgba(242\|0_8px_30px\|0_0_15px\|0_0_20px\|0_0_30px')
C=$(count_hits "$HITS"); S3_COUNT=$((S3_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "Inline box-shadow (check if glow or shadow)" "$HITS"

# 19. font-weight: 700/bold in tsx
HITS=$(grep -rn $EXCLUDE --include="*.tsx" --include="*.jsx" -E "fontWeight.*['\"]?(700|bold)['\"]?" "$TARGET" 2>/dev/null)
C=$(count_hits "$HITS"); S3_COUNT=$((S3_COUNT + C)); VIOLATIONS=$((VIOLATIONS + C))
print_section "font-weight 700/bold in inline styles" "$HITS"

echo ""

# ═══════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════

echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
if [ "$VIOLATIONS" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}✓ No violations found. Clean!${NC}"
else
  echo -e "  ${BOLD}Total violations: $VIOLATIONS${NC}"
  echo ""
  [ "$S1_COUNT" -gt 0 ] && echo -e "    ${RED}S1 Critical: $S1_COUNT${NC}"
  [ "$S2_COUNT" -gt 0 ] && echo -e "    ${YELLOW}S2 Important: $S2_COUNT${NC}"
  [ "$S3_COUNT" -gt 0 ] && echo -e "    ${CYAN}S3 Advisory:  $S3_COUNT${NC}"
fi
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"

exit $VIOLATIONS
