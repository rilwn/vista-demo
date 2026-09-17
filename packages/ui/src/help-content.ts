export type HelpApp = 'operations' | 'pos' | 'recovery';
export type HelpLocale = 'bg' | 'en';
export interface HelpTopic {
  contexts?: string[];
  id: string;
  title: string;
  module?: string;
  steps: string[];
  note?: string;
}

export const helpText = {
  open: 'Help',
  title: 'How can we help?',
  close: 'Close help',
  search: 'Search help',
  placeholder: 'Try payments, stock or sign-in',
  empty: 'No matching guide. Try a different word.',
  back: 'Back to work',
  intro: 'Short guides for this workspace. Available actions depend on your account.',
  current: 'For this page',
};

export const bulgarianHelpText = {
  open: 'Помощ',
  title: 'Как можем да помогнем?',
  close: 'Затваряне на помощта',
  search: 'Търсене в помощта',
  placeholder: 'Например плащане, склад или вход',
  empty: 'Няма съвпадащо ръководство. Опитайте с друга дума.',
  back: 'Назад към работата',
  intro:
    'Кратки ръководства за това работно пространство. Достъпните действия зависят от Вашия профил.',
  current: 'За тази страница',
} as const;

const common: HelpTopic[] = [
  {
    id: 'access',
    title: 'Sign-in and account access',
    steps: [
      'Sign in with your assigned work email and password. If asked, enter the current six-digit code from your authenticator.',
      'If sign-in is temporarily limited, wait before trying again. If access is missing, ask your administrator to review your role.',
      'Never share your password or authenticator code. Sign out when you finish on a shared device.',
    ],
  },
  {
    id: 'errors',
    title: 'When an action cannot be completed',
    steps: [
      'Read the message beside the field and choose a value from the available suggestions.',
      'Keep the current form open after a connection failure. Use its retry action and check the existing record before creating another.',
      'If the problem continues, share the action, record number and error reference with your administrator, without passwords or customer attachments.',
    ],
  },
];

const operations: HelpTopic[] = [
  {
    id: 'administration',
    contexts: ['/security', '/organization', '/operations'],
    title: 'Set up employees, access and business structure',
    steps: [
      'In Business structure, create the legal entity, branch and operating locations before assigning registers, operators or warehouses.',
      'In Security, create or open the employee, assign only the required role, and review two-factor status and active sessions.',
      'Use System activity to confirm the change was recorded. Open the affected employee or location again to verify the saved result.',
    ],
    note: 'Administrative roles require two-factor authentication. Do not broaden a role to solve one missing permission.',
  },
  {
    id: 'master-data',
    contexts: ['/partners', '/catalog'],
    title: 'Prepare partners, products and customer equipment',
    steps: [
      'Create or open the partner and add the correct customer or supplier role, addresses, contacts and business locations.',
      'Create products with category, unit, tracking mode and price. Serialised equipment must use serial tracking; consumables can use batch tracking.',
      'For Service or warranty work, open the customer location and register the installed device with its serial number and warranty dates.',
    ],
    note: 'If Vista warns about a matching UIC or company name, review the existing partner instead of creating a duplicate.',
  },
  {
    id: 'cash-bank',
    module: 'erp.finance',
    contexts: ['/modules/erp.finance/cash', '/modules/erp.finance/cash-bank'],
    title: 'Record cash and reconcile a bank statement',
    steps: [
      'For cash, choose the register and operator, select receipt or payment, enter the date, counterparty, amount and reason, then issue the voucher.',
      'For bank activity, add the statement opening balance and each transaction exactly as shown by the bank, then save the statement.',
      'Open transactions needing review and match them to the correct collection or supplier payable. Confirm the resulting payment and remaining balance.',
    ],
    note: 'Do not match the same transfer twice. A linked cash receipt cannot be cancelled without reversing its payment record.',
  },
  {
    id: 'supplier-balances',
    module: 'erp.finance',
    contexts: ['/modules/erp.finance/payables', '/modules/erp.finance/customer-accounts'],
    title: 'Manage supplier payables, advances and customer credit',
    steps: [
      'Add an eligible supplier invoice to the payable register, confirm its due date and open the saved balance.',
      'Record a payment or supplier advance and allocate only the amount shown as outstanding. Use an offset only when the same partner has both balances.',
      'For customer credit, set dated payment terms and a credit limit or record a received advance, then verify the amount available to POS.',
    ],
    note: 'If no invoice is available, record it against its purchase order in Procurement first.',
  },
  {
    id: 'subscriptions',
    module: 'erp.sales',
    contexts: ['/modules/erp.sales/subscriptions'],
    title: 'Create a service subscription',
    steps: [
      'Confirm that the customer location and covered devices already exist, then select New contract.',
      'Choose the location and devices, enter each included service, visit frequency, contract period, recurring amount and first billing date.',
      'Save the contract and reopen it to verify coverage. Review prepared billing drafts in Finance on the next billing date.',
    ],
    note: 'A device cannot be covered until it is registered at the selected customer location.',
  },
  {
    id: 'crm-workflows',
    module: 'crm',
    contexts: ['/modules/crm/'],
    title: 'Work with CRM records on this page',
    steps: [
      'Select the relevant customer first, then create the interaction, task, lead, ticket, warranty claim, survey or referral from the page action.',
      'Complete every required owner, due date, status and customer-facing detail. Link an existing Sales or Service record instead of creating a duplicate.',
      'Save, reopen the record and confirm its timeline or history shows the action and responsible employee.',
    ],
    note: 'For technician work, create one linked Service request from the ticket. Reopen the existing link for later updates.',
  },
  {
    id: 'stock',
    title: 'Products, stock and serial numbers',
    module: 'erp.warehouse',
    steps: [
      'Choose Warehouse from the sidebar. Review stock for the exact product and warehouse before reserving or selling.',
      'Use a goods receipt or an authorised inventory receipt to add stock. Enter the source reference and any required serial or batch details.',
      'If stock is unavailable, check existing reservations. Do not create another quotation to bypass a reservation.',
    ],
  },
  {
    id: 'procurement',
    title: 'Purchase and receive goods',
    module: 'erp.procurement',
    steps: [
      'Choose Procurement → Purchase orders → Create purchase order. Select the supplier, warehouse and products, then save.',
      'Open the order and choose Receive delivery. Enter only quantities received and the required serial or batch details.',
      'Open Supplier invoices to record the supplier invoice. Compare ordered, delivered and invoiced quantities; record the VAT breakdown before reviewing purchase VAT totals.',
    ],
  },
  {
    id: 'sales',
    title: 'From quotation to collection',
    module: 'erp.sales',
    steps: [
      'Choose Sales → Quotations → New quotation. Select the customer, warehouse, dates and products, then save.',
      'Open Preview, select available serial numbers where required, and confirm the order. Complete the shipment and handover, then prepare its invoice draft.',
      'A Finance user can add the prepared draft to Collections & payments, set its due date and record partial or full payments.',
    ],
    note: 'A prepared draft is not an officially issued invoice.',
  },
  {
    id: 'finance',
    title: 'Payments and financial documents',
    module: 'erp.finance',
    steps: [
      'Choose Finance → Collections & payments. Add a prepared Sales invoice draft to collections, or open an existing collection to record payment.',
      'Use the remaining balance shown on the record. Review advances and offsets separately instead of recording the same money twice.',
      'Choose Financial documents to prepare and preview a linked draft. Open Finance reports for operational journals, VAT review and balances.',
    ],
    note: 'If no draft is available, ask Sales to finish the shipment and prepare its invoice draft. Check existing collections before adding another.',
  },
  {
    id: 'service',
    title: 'Schedule and complete a Service visit',
    module: 'erp.service',
    steps: [
      'Dispatchers choose Service → Service requests to create a request for the customer, location and device, then assign an available technician.',
      'Technicians choose Service → Work orders, open their assigned job and select Start work. Record time, used parts and any photos.',
      'Complete the work with the customer signature. Review the retained evidence and costs; an authorised colleague can prepare the linked Finance draft.',
    ],
    note: 'An appointment must fit the technician’s availability. Parts are taken from the assigned technician warehouse.',
  },
  {
    id: 'crm',
    title: 'Customer follow-up and tickets',
    module: 'crm',
    steps: [
      'Choose Customers & CRM. Use Timeline for interactions and tasks, or Leads & pipeline to qualify and convert a lead.',
      'Open Tickets to record an issue, response and status. Use Create Service request when a technician is needed; reopen the existing link instead of creating a duplicate.',
      'Use Customer care for warranty claims, feedback and referrals. Claims keep their evidence and status history with the device.',
    ],
  },
  {
    id: 'logistics',
    title: 'Deliveries and routes',
    module: 'erp.logistics',
    steps: [
      'Choose Logistics → Deliveries to plan a delivery linked to a shipment.',
      'Use Routes to combine deliveries and Service visits. Keep each Service stop at its scheduled time and duration.',
      'Use returns and reverse logistics for a linked returned device. Courier booking remains unavailable until the provider is configured.',
    ],
  },
  {
    id: 'reports',
    title: 'Reports and attachments',
    steps: [
      'Open the report area of a module you can access. Choose dates and filters, then select Apply before exporting.',
      'Choose Export report and a file type. Download the completed file from Recent exports; use Refresh or the offered retry action if needed.',
      'Open a record’s attachments to upload, replace or download a file. Replacement keeps earlier versions. Export and upload actions require the appropriate permission.',
    ],
  },
];
const pos: HelpTopic[] = [
  {
    id: 'sell',
    contexts: ['sell'],
    title: 'Open a shift and make a sale',
    steps: [
      'Choose Shifts → Open shift. Select the assigned register and enter the actual opening cash.',
      'Choose Sell. Scan or search for a product, set quantities and select the customer when required. Serial-tracked products require an available serial number.',
      'Review offers and totals, choose the payment method and complete the sale. Open Sale history to review its documents.',
    ],
    note: 'Test receipt mode does not issue a certified fiscal receipt. Hardware and official issuance must be approved before live use.',
  },
  {
    id: 'payments',
    contexts: ['sell'],
    title: 'Discounts, rewards and split payments',
    steps: [
      'Select the customer before reviewing corporate prices or rewards. Automatic offers appear in the sale totals.',
      'Request authorised approval for a manual discount. Choose the permitted reward points to use.',
      'For a split payment, enter each amount and ensure the methods cover the total. Use an advance or on-account payment only when available for that customer.',
    ],
  },
  {
    id: 'returns',
    contexts: ['returns', 'shifts'],
    title: 'Return goods and close the shift',
    steps: [
      'Choose Returns and find the original sale. Select eligible items, their condition and the return reason.',
      'Review the refund and stock destination before confirming. Repairable devices follow the Service return path.',
      'Choose Shifts, open the current shift, review totals and enter counted cash before closing. Use Reports to download the period or shift results.',
    ],
  },
  {
    id: 'checkout',
    contexts: ['checkouts'],
    title: 'Recover an interrupted checkout',
    steps: [
      'If the connection fails during checkout, keep the saved checkout. Do not start another sale for the same purchase.',
      'When connected, choose Recovery, open the checkout and use its status check or retry action.',
      'Confirm the resulting sale in Sale history before taking payment again.',
    ],
    note: 'Checkout recovery is not full offline selling. Do not clear browser storage while a checkout is unresolved.',
  },
  {
    id: 'pos-documents',
    contexts: ['sales'],
    title: 'Review a receipt, invoice and warranty cards',
    steps: [
      'Open Sale history and select the receipt by its sale number, customer or time.',
      'Review payment methods, returned quantities and fiscal status. Create the invoice draft only when the customer is attached to the sale.',
      'For serialised equipment, download each warranty card and confirm the serial number, customer and warranty dates.',
    ],
    note: 'An invoice draft still requires the authorised Finance review and issue process.',
  },
  {
    id: 'pos-reports',
    contexts: ['reports'],
    title: 'Review and export POS reports',
    steps: [
      'Choose the reporting period, location, register and cashier, then select Apply.',
      'Open the required shift, cashier, product, category, payment or location view and confirm the totals.',
      'Select Export current report, choose the fields and file type, then download the completed file from Recent exports.',
    ],
    note: 'A test-register preview is not a certified fiscal X or Z report.',
  },
];
const recovery: HelpTopic[] = [
  {
    id: 'setup',
    title: 'What is available in Vista Recovery',
    steps: [
      'Sign in with an assigned Backup role and verify your authenticator. A password-only sign-in cannot open the console.',
      'Use the navigation to review the planned areas for sources, policies, jobs, restores, audit and recovery tests.',
      'Ask the infrastructure owner to confirm backup sources, storage and tape hardware, retention, recovery targets and responsible approvers.',
    ],
    note: 'The console is not yet an operational backup service. It does not create restore points or restore data. Do not rely on it to protect live information.',
  },
  {
    id: 'recovery-area',
    contexts: ['overview', 'jobs', 'sources', 'policies', 'approvals', 'dr-tests', 'audit'],
    title: 'Review readiness for this recovery area',
    steps: [
      'Review the readiness cards and identify the missing source inventory, approved policy or recorded restore test.',
      'Use the current area to confirm the required owner, scope, protection target, retention, RPO, RTO or approval evidence with the infrastructure team.',
      'Record the agreed decision in the implementation handover. Enable operational actions only after storage, tape hardware, credentials and approvers are confirmed.',
    ],
    note: 'The disabled actions are intentional. This screen does not run backups or restores until the approved infrastructure integration is completed.',
  },
];

const bulgarianTopics: Readonly<Record<string, Omit<HelpTopic, 'id' | 'module'>>> = {
  administration: {
    title: 'Настройване на служители, достъп и бизнес структура',
    steps: [
      'В Бизнес структура създайте юридическото лице, клона и работните обекти, преди да назначавате каси, оператори или складове.',
      'В Сигурност създайте или отворете служителя, задайте само необходимата роля и проверете двуфакторната защита и активните сесии.',
      'В Системна активност потвърдете, че промяната е записана. Отворете отново служителя или обекта и проверете резултата.',
    ],
    note: 'Административните роли изискват двуфакторна защита. Не разширявайте цяла роля заради едно липсващо право.',
  },
  'master-data': {
    title: 'Подготовка на партньори, продукти и клиентско оборудване',
    steps: [
      'Създайте или отворете партньора и добавете правилната роля на клиент или доставчик, адреси, контакти и бизнес обекти.',
      'Създайте продукт с категория, мерна единица, режим на проследяване и цена. Оборудването използва серийни номера, а консумативите могат да използват партиди.',
      'За сервизна или гаранционна работа отворете обекта на клиента и регистрирайте устройството със сериен номер и гаранционни дати.',
    ],
    note: 'При предупреждение за съвпадащ ЕИК или име прегледайте съществуващия партньор, вместо да създавате дубликат.',
  },
  'cash-bank': {
    title: 'Касови операции и банково съпоставяне',
    steps: [
      'За касова операция изберете каса и оператор, приход или разход, въведете дата, контрагент, сума и основание и издайте ордера.',
      'За банка въведете началното салдо и транзакциите точно както са в извлечението и го запазете.',
      'Отворете транзакциите за преглед и ги съпоставете с правилното вземане или задължение. Проверете плащането и оставащото салдо.',
    ],
    note: 'Не съпоставяйте един превод два пъти. Свързан приходен ордер изисква сторниране на плащането преди анулиране.',
  },
  'supplier-balances': {
    title: 'Задължения, аванси и клиентски кредит',
    steps: [
      'Добавете допустима фактура от доставчик в регистъра на задълженията, потвърдете падежа и отворете записаното салдо.',
      'Запишете плащане или аванс и разпределете само непогасената сума. Използвайте прихващане само когато партньорът има и двете насрещни салда.',
      'За клиентски кредит задайте валидни условия и лимит или запишете получен аванс и проверете наличната сума в POS.',
    ],
    note: 'Ако няма налична фактура, първо я въведете към поръчката за покупка в Снабдяване.',
  },
  subscriptions: {
    title: 'Създаване на сервизен абонамент',
    steps: [
      'Потвърдете, че обектът на клиента и включените устройства съществуват, след което изберете Нов договор.',
      'Изберете обекта и устройствата и въведете услугите, честотата, срока, периодичната сума и първата дата за фактуриране.',
      'Запазете и отворете договора отново, за да проверите покритието. На следващата дата прегледайте черновата във Финанси.',
    ],
    note: 'Устройство не може да бъде включено, преди да е регистрирано в избрания клиентски обект.',
  },
  'crm-workflows': {
    title: 'Работа с CRM записите на тази страница',
    steps: [
      'Първо изберете клиента, след което създайте взаимодействие, задача, потенциален клиент, сигнал, рекламация, анкета или препоръка.',
      'Попълнете отговорника, срока, статуса и данните за клиента. Свържете съществуващ запис от Продажби или Сервиз, вместо да създавате дубликат.',
      'Запазете, отворете записа отново и потвърдете, че хронологията показва действието и отговорния служител.',
    ],
    note: 'При нужда от техник създайте една свързана сервизна заявка от сигнала и използвайте същата връзка за следващи промени.',
  },
  'pos-documents': {
    title: 'Преглед на бележка, фактура и гаранционни карти',
    steps: [
      'Отворете История на продажбите и изберете бележката по номер, клиент или час.',
      'Проверете плащанията, върнатите количества и фискалния статус. Създайте чернова на фактура само ако към продажбата има клиент.',
      'За оборудване със сериен номер изтеглете всяка гаранционна карта и проверете номера, клиента и гаранционните дати.',
    ],
    note: 'Черновата на фактура изисква окончателен преглед и издаване от упълномощен служител във Финанси.',
  },
  'pos-reports': {
    title: 'Преглед и експорт на POS отчети',
    steps: [
      'Изберете период, обект, каса и касиер и натиснете Приложи.',
      'Отворете нужния изглед за смени, касиери, продукти, категории, плащания или обекти и проверете сумите.',
      'Изберете Експорт на текущия отчет, полета и формат и изтеглете готовия файл от Последни експорти.',
    ],
    note: 'Прегледът от тестова каса не е сертифициран фискален X или Z отчет.',
  },
  'recovery-area': {
    title: 'Преглед на готовността за този раздел',
    steps: [
      'Прегледайте картите за готовност и установете липсващия инвентар, одобрена политика или записан тест за възстановяване.',
      'Потвърдете с инфраструктурния екип отговорника, обхвата, целта за защита, срока, RPO, RTO и необходимите одобрения.',
      'Запишете решението в документацията за предаване. Активирайте действията само след потвърждение на хранилището, лентовия хардуер, достъпа и одобряващите.',
    ],
    note: 'Неактивните действия са умишлени. Екранът не изпълнява архивиране или възстановяване преди одобрената инфраструктурна интеграция.',
  },
  access: {
    title: 'Вход и достъп до профила',
    steps: [
      'Влезте със служебния си имейл и парола. При поискване въведете текущия шестцифрен код от приложението за удостоверяване.',
      'Ако входът е временно ограничен, изчакайте преди нов опит. Ако нямате достъп, помолете администратора да провери ролята Ви.',
      'Не споделяйте паролата или кода си. Излизайте от профила, когато приключите работа на споделено устройство.',
    ],
  },
  errors: {
    title: 'Когато дадено действие не може да бъде завършено',
    steps: [
      'Прочетете съобщението до полето и изберете стойност от наличните предложения.',
      'При проблем с връзката оставете текущия формуляр отворен. Използвайте повторния опит и проверете съществуващия запис, преди да създадете нов.',
      'Ако проблемът продължи, изпратете на администратора действието, номера на записа и референцията на грешката, без пароли или клиентски файлове.',
    ],
  },
  stock: {
    title: 'Продукти, наличности и серийни номера',
    steps: [
      'От страничното меню изберете Склад. Проверете точния продукт и склад, преди да резервирате или продавате.',
      'Добавете наличност чрез приемане на стока или разрешен складов приход. Въведете изходния документ и необходимите серийни номера или партиди.',
      'Ако няма свободна наличност, проверете съществуващите резервации. Не създавайте друга оферта, за да заобиколите резервация.',
    ],
  },
  procurement: {
    title: 'Покупка и приемане на стоки',
    steps: [
      'Изберете Снабдяване → Поръчки за покупка → Създаване на поръчка. Изберете доставчик, склад и продукти и запазете.',
      'Отворете поръчката и изберете Приемане на доставка. Въведете само получените количества и необходимите серийни номера или партиди.',
      'Във Фактури от доставчици въведете фактурата. Сравнете поръчаното, доставеното и фактурираното количество и попълнете ДДС данните.',
    ],
  },
  sales: {
    title: 'От оферта до вземане',
    steps: [
      'Изберете Продажби → Оферти → Нова оферта. Изберете клиент, склад, дати и продукти и запазете.',
      'Отворете прегледа, изберете необходимите серийни номера и потвърдете поръчката. Завършете експедицията и предаването, след което подгответе чернова на фактура.',
      'Служител от Финанси може да добави черновата към Вземания и плащания, да зададе падеж и да запише частично или пълно плащане.',
    ],
    note: 'Подготвената чернова не е официално издадена фактура.',
  },
  finance: {
    title: 'Плащания и финансови документи',
    steps: [
      'Изберете Финанси → Вземания и плащания. Добавете подготвена чернова от Продажби или отворете съществуващо вземане, за да запишете плащане.',
      'Използвайте оставащото салдо от записа. Преглеждайте авансите и прихващанията отделно, за да не въведете една и съща сума два пъти.',
      'Във Финансови документи подгответе и прегледайте свързана чернова. Използвайте Финансови отчети за дневници, ДДС и салда.',
    ],
    note: 'Ако няма налична чернова, Продажби трябва да завърши експедицията и да подготви фактурата. Проверете съществуващите вземания, преди да добавите ново.',
  },
  service: {
    title: 'Планиране и завършване на сервизно посещение',
    steps: [
      'Диспечерът избира Сервиз → Сервизни заявки, създава заявка за клиента, обекта и устройството и назначава свободен техник.',
      'Техникът избира Сервиз → Работни поръчки, отваря назначената работа и избира Започване. Записва време, използвани части и снимки.',
      'Работата се завършва с подпис от клиента. Прегледайте доказателствата и разходите; упълномощен служител може да подготви свързания финансов документ.',
    ],
    note: 'Посещението трябва да е в работното време на техника. Частите се изписват от назначения склад на техника.',
  },
  crm: {
    title: 'Последващи действия и клиентски сигнали',
    steps: [
      'Изберете Клиенти и CRM. Използвайте Хронология за взаимодействия и задачи или Потенциални клиенти за квалифициране и преобразуване.',
      'В Сигнали запишете проблема, отговора и статуса. Ако е нужен техник, създайте сервизна заявка; използвайте съществуващата връзка вместо дублиране.',
      'В Грижа за клиента управлявайте гаранционни рекламации, обратна връзка и препоръки. Доказателствата и историята остават към устройството.',
    ],
  },
  logistics: {
    title: 'Доставки и маршрути',
    steps: [
      'Изберете Логистика → Доставки, за да планирате доставка към експедиция.',
      'В Маршрути обединете доставки и сервизни посещения. Запазете планирания час и продължителност на сервизните спирки.',
      'Използвайте Връщания за свързано върнато устройство. Заявките към куриер остават недостъпни до настройване на доставчика.',
    ],
  },
  reports: {
    title: 'Отчети и прикачени файлове',
    steps: [
      'Отворете отчетите на достъпен модул. Изберете дати и филтри и натиснете Приложи преди експорт.',
      'Изберете Експорт на отчет и файлов формат. Изтеглете готовия файл от Последни експорти; при нужда използвайте Обновяване или повторен опит.',
      'Отворете файловете към запис, за да качите, замените или изтеглите документ. Замяната пази предишните версии. Действията изискват съответните права.',
    ],
  },
  sell: {
    title: 'Отваряне на смяна и продажба',
    steps: [
      'Изберете Смени → Отваряне на смяна. Изберете назначената каса и въведете действителната начална наличност.',
      'Изберете Продажба. Сканирайте или потърсете продукт, задайте количествата и при нужда изберете клиент. Проследяваните продукти изискват наличен сериен номер.',
      'Прегледайте офертите и сумите, изберете начин на плащане и завършете продажбата. Проверете документите в История на продажбите.',
    ],
    note: 'Режимът на тестова бележка не издава сертифициран фискален документ. Хардуерът и официалното издаване трябва да бъдат одобрени преди реална работа.',
  },
  payments: {
    title: 'Отстъпки, награди и разделени плащания',
    steps: [
      'Изберете клиента, преди да прегледате корпоративните цени или награди. Автоматичните оферти се показват в сумите.',
      'Поискайте разрешение за ръчна отстъпка и изберете допустимите точки за използване.',
      'При разделено плащане въведете всяка сума и се уверете, че начините покриват общата стойност. Използвайте аванс или плащане по сметка само ако е налично.',
    ],
  },
  returns: {
    title: 'Връщане на стоки и затваряне на смяната',
    steps: [
      'Изберете Връщания и намерете първоначалната продажба. Изберете допустимите артикули, състоянието им и причината.',
      'Прегледайте възстановяването на сумата и склада преди потвърждение. Ремонтируемите устройства се насочват към Сервиз.',
      'В Смени отворете текущата смяна, прегледайте сумите и въведете преброената наличност преди затваряне. Използвайте Отчети за изтегляне на резултатите.',
    ],
  },
  checkout: {
    title: 'Възстановяване на прекъснато плащане',
    steps: [
      'Ако връзката прекъсне по време на плащане, запазете плащането. Не започвайте нова продажба за същата покупка.',
      'След възстановяване на връзката изберете Възстановяване, отворете плащането и проверете статуса или опитайте отново.',
      'Потвърдете получената продажба в История на продажбите, преди да приемете плащане повторно.',
    ],
    note: 'Възстановяването на плащане не е пълна офлайн продажба. Не изчиствайте данните на браузъра, докато има нерешено плащане.',
  },
  setup: {
    title: 'Какво е налично във Vista Recovery',
    steps: [
      'Влезте с назначена роля за архивиране и потвърдете приложението за удостоверяване. Само парола не може да отвори конзолата.',
      'Използвайте навигацията, за да прегледате планираните раздели за източници, политики, задачи, възстановявания, одит и DR тестове.',
      'Поискайте от собственика на инфраструктурата да потвърди източниците, хранилището, лентовия хардуер, сроковете, целите и отговорните одобряващи.',
    ],
    note: 'Конзолата все още не е действаща услуга за архивиране. Тя не създава точки за възстановяване и не възстановява данни. Не разчитайте на нея за защита на реална информация.',
  },
};

export function helpTopics(
  app: HelpApp,
  modules: readonly string[] = [],
  locale: HelpLocale = 'en',
  context = '',
): HelpTopic[] {
  const topics = app === 'operations' ? operations : app === 'pos' ? pos : recovery;
  const visible = [
    ...topics.filter(
      (topic) =>
        (!topic.module || modules.includes(topic.module)) &&
        (!context ||
          !topic.contexts?.length ||
          topic.contexts.some((item) => context.startsWith(item))),
    ),
    ...common,
  ];
  if (context) {
    visible.sort((left, right) => Number(Boolean(right.contexts)) - Number(Boolean(left.contexts)));
  }
  if (locale === 'en') return visible;
  return visible.map((topic) => ({ ...topic, ...(bulgarianTopics[topic.id] ?? {}) }));
}
