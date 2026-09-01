# Test CRM leads and sales opportunities

Start the system with `npm run dev`, then sign in to the ERP/CRM app as
`crm@vista.local` with your local fixture password.

Use a unique suffix such as `0901` anywhere this guide says `<suffix>`.

## Workspace navigation check

1. Confirm the sidebar starts with the Vista icon and ends with the protected
   session and **My access & security** cards.
2. Select the search field in the top bar, enter `Leads & opportunities`, and
   open the matching result. You can also press `/` to focus the search, use the
   arrow keys, and press `Enter`.
3. Open the account menu at the top right. Confirm it shows your name, email,
   **My access & security**, **Overview**, the pages allowed for your role, and
   **Sign out**.
4. At phone width, confirm the menu button, search, notifications, and account
   button remain on one row. Search results must fit without horizontal
   scrolling.

## 1. Add and qualify a lead

1. From the sidebar choose **Customers & CRM**.
2. Under **Choose an area**, select **Leads & opportunities**.
3. Select **New lead** and enter:
   - Company or prospect name: `North Star Retail <suffix> Ltd.`
   - Contact person: `Petar Dimitrov`
   - Telephone: `+359 888 200 300`
   - Lead source: **Trade exhibition**
   - Owner: **Vista Demo CRM Coordinator**
   - Source details: `Vratsa retail technology exhibition`
   - Notes: `Interested in a fiscal device and annual service.`
4. Select **Save lead**, open the new row, and select **Mark as qualified**.

Expected: the lead shows **Qualified** and its history contains **Lead
registered** and **Lead qualified**.

## 2. Convert it to a customer and opportunity

1. In the same lead panel select **Convert lead**.
2. Keep **Create customer** and **Create a sales opportunity** selected.
3. Enter:
   - Customer name: keep the lead company name
   - Customer type: **Company**
   - Company registration number: `CRM<suffix>`
   - Opportunity name: `Fiscal device and annual service package`
   - Estimated value: `1800.00`
   - Probability: `40`
   - Expected close date: choose a date about 30 days from today
   - Owner: **Vista Demo CRM Coordinator**
4. Select **Convert lead**.

Expected: one customer and one opportunity are created. The lead changes to
**Converted**; selecting the same action again is not offered.

## 3. Move the sales opportunity

1. Select **Sales pipeline** near the top of the page.
2. Find `Fiscal device and annual service package` under **Qualified**.
3. Drag it to **Quotation sent**. If you prefer keyboard controls, open the card,
   choose **Quotation sent**, set probability to `60`, and select **Update stage**.
4. Open the card and review **Opportunity history**, then select **Back**.

Expected: the card remains under **Quotation sent** after refresh, and the
history shows the employee, time, previous stage, new stage, and probability.

## Quick UI check

- Open the qualified lead and scroll to **Lead history**. The panel content
  scrolls, while **Back**, the title, and the close button remain visible.
- Select **Convert lead**. Its form scrolls independently; the header stays
  visible and the **Back / Convert lead** bar fits the full bottom edge with no
  gap underneath it.
- Open the opportunity from **Sales pipeline**. Its cards, fields, amounts, and
  history remain aligned without a second page scrollbar.
- At phone width, the pipeline and all three panels become a readable vertical
  flow with no horizontal scrolling.
- Press `Esc`; the panel closes and focus returns to the button that opened it.
