// Development differs month to month at this age, so the profile takes a birth date, not a year.
export function ageInMonths(birth) {
  if (!birth || !birth.y || !birth.m || !birth.d) return null;
  const now = new Date();
  const months = (now.getFullYear() - birth.y) * 12 + (now.getMonth() + 1 - birth.m);
  return now.getDate() < birth.d ? months - 1 : months;
}

export function ageLabel(birth) {
  const months = ageInMonths(birth);
  if (months == null || months < 0 || months > 300) return '';
  return `만 ${Math.floor(months / 12)}세 ${months % 12}개월`;
}
