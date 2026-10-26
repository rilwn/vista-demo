const en = {
  original: 'Original amount',
  credits: 'Credit notes',
  debits: 'Debit notes',
  adjusted: 'Amount after corrections',
  customerCredit: 'Customer credit',
  overpaidHelp:
    'Payments exceed the corrected amount. Review this credit before arranging a refund or using it elsewhere. No refund or advance was created.',
  corrections: 'Applied corrections',
  creditNote: 'Credit note',
  debitNote: 'Debit note',
  openNote: 'Open note',
  openOriginal: 'Open original invoice',
  originalInvoice: 'Original invoice',
  draftHelp: 'The original balance changes only when this note is issued.',
  history: 'Issued note applied to the balance',
  migratedHistory: 'Existing issued notes applied to the balance',
};
const bg: Record<keyof typeof en, string> = {
  original: 'Първоначална сума',
  credits: 'Кредитни известия',
  debits: 'Дебитни известия',
  adjusted: 'Сума след корекциите',
  customerCredit: 'Надплатена сума',
  overpaidHelp:
    'Плащанията надвишават коригираната сума. Прегледайте надплащането, преди да го възстановите или използвате за друго задължение. Не е създадено възстановяване или аванс.',
  corrections: 'Приложени корекции',
  creditNote: 'Кредитно известие',
  debitNote: 'Дебитно известие',
  openNote: 'Отвори известието',
  openOriginal: 'Отвори първоначалната фактура',
  originalInvoice: 'Първоначална фактура',
  draftHelp: 'Първоначалното салдо се променя само след издаване на известието.',
  history: 'Издадено известие е приложено към салдото',
  migratedHistory: 'Съществуващи издадени известия са приложени към салдото',
};
export function collectionCorrectionsMessages(locale: 'en' | 'bg') {
  return locale === 'bg' ? bg : en;
}
