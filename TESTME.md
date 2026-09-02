# Test CRM customer care

Start the system with `npm run dev`, then sign in to the ERP/CRM app as
`crm@vista.local` using your local fixture password.

From the sidebar choose **Customers & CRM**, then under **Choose an area** open
**Warranty, feedback & referrals**.

## 1. Review a warranty and complete a claim

1. Under **Warranties**, open `DEV-WCR-0001`.
2. Set **Follow-up status** to **Offer presented** and select **Save status**.
3. Select **New claim** and enter:
   - Device: keep the selected fiscal device
   - Description: `Fiscal memory test fails after startup. Customer restarted the device twice.`
4. Select **Create claim**, then open the new claim in **Warranty claims**.
5. Under **Supporting files**, choose a small PDF or PNG and select **Upload file**.
6. Select **Start review**.
7. Enter the decision note `Fault confirmed under warranty.` and select
   **Approve claim**.
8. Select **Close claim**.

Expected: the same claim moves through **Received → Under review → Approved →
Closed**, and its history records each step. The warranty card remains linked to
the device and serial number, and the uploaded file remains available.

## 2. Send a survey and record its response

1. Select **Feedback & NPS**, then **Send survey**.
2. Choose any available completed Service job and select **Send survey**.
3. Open the new survey, choose score `10`, and enter
   `Fast visit and a clear explanation from the technician.`
4. Select **Save response**.

Expected: the survey shows **Responded**, score `10`, and **Promoters** increases
by one. The completed job can no longer receive a duplicate survey.

## 3. Record a referral

1. Select **Referrals**, then **Record referral**.
2. Enter:
   - Referring customer: **Alfa Market Demo Ltd.**
   - Lead owner: **Vista Demo CRM Coordinator**
   - Organization: `TEST Referral Shop 0902`
   - Contact person: `Mila Petrova`
   - Telephone: `+359 888 555 902`
   - Context: `Interested in a fiscal device and annual Service plan.`
3. Select **Record referral**.

Expected: the referral appears once with a linked lead number. Select the lead
number and confirm `TEST Referral Shop 0902` appears in **Leads & pipeline** under
**New**.

## Quick UI check

- Open each panel and scroll from top to bottom. The header remains separate,
  the content scrolls, and the action bar has no gap beneath it.
- At phone width, cards, tabs, score buttons, and forms fit without horizontal
  scrolling.
- Press `Esc` in a panel; it closes without saving an unfinished form.
