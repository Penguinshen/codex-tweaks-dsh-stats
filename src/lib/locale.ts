export interface ChatViewSlotProps {
  t: (key: 'number.thousand' | 'number.million' | 'number.groupSeparator', args?: { value: string }) => string
}

export const tokenLocale: ChatViewSlotProps['t'] = (key, args) => {
  if (key === 'number.groupSeparator') return ','
  return `${args?.value}${key === 'number.thousand' ? 'K' : 'M'}`
}

