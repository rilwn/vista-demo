const en = {
  title: 'Document settings',
  company: 'Issuing company',
  loading: 'Loading document settings',
  loadError: 'Document settings could not be loaded.',
  retry: 'Try again',
  back: 'Back',
  description: 'Use your company logo and an authorized signature on financial documents.',
  applies: 'Changes apply to newly issued documents. Existing invoices keep their saved images.',
  logo: 'Company logo',
  signature: 'Signature image',
  imageHelp:
    'PNG or JPEG, up to 512 KB. Use a standard, non-interlaced image up to 2048 pixels per side and two megapixels.',
  signatureHelp:
    'A visual signature image, not a digital certificate. It is printed only after the document is issued.',
  name: 'Signature name',
  confirmation: 'I am authorized to use this signature on this company’s financial documents.',
  upload: 'Upload image',
  choose: 'Choose image',
  uploading: 'Uploading…',
  remove: 'Remove',
  notSet: 'No image selected',
  save: 'Save settings',
  saving: 'Saving…',
  saved: 'Document settings saved.',
  uploaded: 'Image uploaded. Save settings to apply it.',
  uploadError: 'The image could not be uploaded. Check its format and try again.',
  saveError: 'Settings could not be saved. Check the fields and try again.',
  invalid: 'Use a standard PNG or JPEG within the stated size limits.',
  stale: 'Settings changed. Close this panel and open it again to review the latest version.',
  signatureRequired: 'Enter the signature name and confirm that its use is authorized.',
  previewError: 'Image preview unavailable.',
  imageError: 'A document image could not be verified. Contact your administrator.',
  fileRequired: 'Choose an image first.',
  readOnly: 'You can view these settings. A Finance user with edit access can change them.',
  empty: 'Add an active issuing location in Business structure before configuring document images.',
};
const bg: Record<keyof typeof en, string> = {
  title: 'Настройки на документите',
  company: 'Фирма издател',
  loading: 'Зареждане на настройките',
  loadError: 'Настройките на документите не могат да бъдат заредени.',
  retry: 'Повторен опит',
  back: 'Назад',
  description:
    'Използвайте фирмено лого и разрешено изображение на подпис във финансовите документи.',
  applies:
    'Промените важат за новоиздадени документи. Съществуващите фактури запазват своите изображения.',
  logo: 'Фирмено лого',
  signature: 'Изображение на подпис',
  imageHelp:
    'PNG или JPEG до 512 KB. Използвайте стандартно изображение без презредово сканиране, до 2048 пиксела на страна и два мегапиксела.',
  signatureHelp:
    'Изображение на подпис, а не цифров сертификат. Отпечатва се само след издаване на документа.',
  name: 'Име на подписващия',
  confirmation: 'Имам разрешение да използвам този подпис във финансовите документи на фирмата.',
  upload: 'Качване на изображение',
  choose: 'Избор на изображение',
  uploading: 'Качване…',
  remove: 'Премахване',
  notSet: 'Няма избрано изображение',
  save: 'Запазване на настройките',
  saving: 'Запазване…',
  saved: 'Настройките са запазени.',
  uploaded: 'Изображението е качено. Запазете настройките, за да го приложите.',
  uploadError: 'Изображението не е качено. Проверете формата и опитайте отново.',
  saveError: 'Настройките не са запазени. Проверете полетата и опитайте отново.',
  invalid: 'Използвайте стандартен PNG или JPEG в посочените граници за размер.',
  stale:
    'Настройките са променени. Затворете панела и го отворете отново за преглед на последната версия.',
  signatureRequired: 'Въведете име и потвърдете разрешението за използване на подписа.',
  previewError: 'Прегледът на изображението не е достъпен.',
  imageError: 'Изображение в документа не може да бъде проверено. Свържете се с администратора.',
  fileRequired: 'Първо изберете изображение.',
  readOnly:
    'Можете да преглеждате настройките. Служител с права за промяна във Финанси може да ги променя.',
  empty:
    'Добавете активен обект на издаване във Фирмена структура, преди да настройвате изображенията.',
};
export function financialBrandingMessages(locale: 'en' | 'bg') {
  return locale === 'bg' ? bg : en;
}
