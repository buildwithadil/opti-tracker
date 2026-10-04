/** Independent expected formats, shared only by customer tests. */
export function acceptedMobileForms(national: string): string[] {
  const grouped = [national, `${national.slice(0, 5)} ${national.slice(5)}`, `${national.slice(0, 5)}-${national.slice(5)}`]
  return [...grouped, ...['0', '91', '+91', '0091'].flatMap(prefix =>
    ['', ' ', '-'].flatMap(separator => grouped.map(number => `${prefix}${separator}${number}`)))]
}

export const invalidMobileInputs: unknown[] = [
  undefined, null, true, false, 9876543210, {}, [], '', ' ', '+91', '0091',
  '987654321', '98765432100', '1234567890', '5123456789', '0000000000',
  '+19876543210', '+449876543210', '00929876543210', '929876543210',
  '0919876543210', '+9109876543210', '009109876543210', '0009876543210',
  '++919876543210', '91+9876543210', '9876543210+', '98765+43210',
  '(98765) 43210', '+91 (98765) 43210', '98765.43210', '98765/43210',
  '98765_43210', '98765,43210', '98765  43210', '98765--43210',
  '+91  9876543210', '+91--9876543210', '9 876543210', '9876 543210',
  '987654 3210', '987 654 3210', '9-8-7-6-5-4-3-2-1-0',
  '98765\t43210', '9876543210\n', '\t9876543210', '98765\u00a043210',
  '９８７６５４３２１０', '९८७६५४३२१०', '98765\u200b43210',
  '98765\0' + '43210', '9876543210 ext 1', 'abcdefghij', '9'.repeat(33),
  ' '.repeat(23) + '9876543210',
]

export const PUBLIC_CUSTOMER_KEYS = ['uuid', 'name', 'phone', 'normalized_phone', 'created_at', 'updated_at', 'archived_at'].sort()
