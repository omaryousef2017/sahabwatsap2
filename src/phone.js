// يحوّل أي صيغة مصرية/دولية إلى wa_id: أرقام فقط مع كود الدولة (بدون +).
export function normalizePhone(input) {
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = '20' + d.slice(1); // 01012345678 → 201012345678
  return d;
}
