"""Money is always an int number of piastres (1 EGP = 100 piastres); rates are basis points (1% = 100 bp)."""

PIASTRES_PER_EGP = 100
BP_PER_UNIT = 10_000


def egp(pounds: float) -> int:
    return round(pounds * PIASTRES_PER_EGP)


def format_egp(piastres: int) -> str:
    value = piastres / PIASTRES_PER_EGP
    text = f"{value:,.0f}" if value == int(value) else f"{value:,.2f}"
    return f"{text} ج"
