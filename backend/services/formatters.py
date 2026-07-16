def _trim_fixed(value: float, digits: int = 2) -> str:
    return f"{float(value):.{digits}f}".rstrip("0").rstrip(".")


def _fixed(value: float, digits: int = 2) -> str:
    return f"{float(value):.{digits}f}"


def format_currency(value: float) -> str:
    amount = round(float(value or 0))
    sign = "-" if amount < 0 else ""
    return f"{sign}${abs(amount):,}"


def format_number(value: float) -> str:
    return f"{float(value or 0):,.0f}"


def format_metric_currency(value: float, threshold: float = 100_000) -> str:
    amount = float(value or 0)
    sign = "-" if amount < 0 else ""
    absolute = abs(amount)
    if absolute < threshold:
        return format_currency(amount)
    if absolute >= 1_000_000_000:
        return f"{sign}${_trim_fixed(absolute / 1_000_000_000, 1)}B"
    if absolute >= 10_000_000:
        return f"{sign}${round(absolute / 1_000_000):,}M"
    if absolute >= 1_000_000:
        return f"{sign}${_fixed(absolute / 1_000_000, 2)}M"
    return f"{sign}${_trim_fixed(absolute / 1_000, 1)}K"


def format_percent(value: float, digits: int = 2) -> str:
    number = float(value or 0)
    percent = number * 100 if 0 < abs(number) < 1 else number
    return f"{_trim_fixed(percent, digits)}%"


def format_interest_rate(value: float) -> str:
    number = float(value or 0)
    rate = number * 100 if 0 < abs(number) < 1 else number
    return f"{rate:.3f}%"
