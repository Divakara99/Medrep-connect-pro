/**
 * Full terms and conditions for MedRep Connect Pro users.
 *
 * Shown from the Plans screen ("Click here"). Keep this file in step with what
 * the app actually does: plans and payments (src/data/plans.ts, payments.ts),
 * job visibility (supabase/secure_jobs.sql), applications (src/data/apply.ts),
 * resume storage (supabase/resumes.sql) and support tickets (src/data/tickets.ts).
 *
 * Text in [square brackets] must be completed by the owner before publication.
 */
export const TERMS_LAST_UPDATED = '13 October 2026'

export type TermsSection = { title: string; paragraphs: string[] }

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: 'About this service',
    paragraphs: [
      'MedRep Connect Pro ("the App", "we", "us") is a job-listing and subscription service for pharmaceutical field roles, such as Medical Representative (MR) and Area Business Manager (ABM), and for multi-industry vacancies. The App is operated by [registered owner name and address — to be completed by the owner].',
      'We publish vacancies supplied by employers and their hiring managers. We connect job seekers with those managers. We are not the employer, not a recruitment agency, and not a party to any employment contract.',
    ],
  },
  {
    title: 'Eligibility and your account',
    paragraphs: [
      'You must be at least 18 years old and legally able to take up employment in India or in the place where the role is located.',
      'Sign in with an email address that you control. Keep your password and one-time codes private. You are responsible for all activity through your account.',
      'Give accurate information in your profile, resume and applications. Information you know to be false may lead to suspension of your account.',
    ],
  },
  {
    title: 'Job listings',
    paragraphs: [
      'Listings are provided in good faith. We do not guarantee that a vacancy is still open, that its details (location, salary, experience or responsibilities) are accurate, or that you will be hired.',
      'Free accounts see limited details. Subscribers can also see the company name, manager details and contact numbers, where the employer has provided them.',
      'Vacancies may be changed, filled or withdrawn at any time without notice.',
    ],
  },
  {
    title: 'Subscription plans and access',
    paragraphs: [
      'Plans are one-time purchases for a fixed number of days (for example 5 days, 15 days, 30 days, 3 months, 6 months or 1 year). Each plan has a price in Indian rupees (INR) shown in the App.',
      'Prices and durations are held on our server. The amount charged at checkout is the server price; the App cannot change it.',
      'Access starts only after our server has verified the payment. Plans do not renew automatically. To extend access, buy another plan.',
      'If you buy a plan while your access is still active, the new days are added to your current expiry date. If your access has expired, the new plan starts from the time of purchase.',
      'Your expiry date is shown on the Account and Plans screens.',
    ],
  },
  {
    title: 'Payments',
    paragraphs: [
      'Online payments are processed by Razorpay through Razorpay Checkout. The methods available (cards, netbanking, UPI apps or QR codes) depend on what Razorpay enables for our merchant account. We do not store your card or bank details.',
      'We never ask you to transfer money to a personal UPI ID or bank account. If anyone asks you to do so in our name, do not pay, and report it through a support ticket.',
      'For any older manual UPI request, our administrator may verify the payment against the bank statement before access is activated. This can take longer than an online payment.',
      'Never share your bank PIN, UPI PIN, OTP or password with anyone, including our support staff.',
    ],
  },
  {
    title: 'Refunds and cancellations',
    paragraphs: [
      'Plans give immediate access to digital content once the payment is verified, so plans are non-refundable after activation, except as described below.',
      'You may request a refund by raising a support ticket with your payment ID or UTR if: (a) your payment was captured but your plan was not activated and we cannot fix this; (b) you were charged more than once for the same plan; or (c) a payment failed but the amount was debited.',
      'Approved refunds are returned to the original payment source through Razorpay. The time to reach your account depends on your bank.',
      'Nothing in these terms limits any right you have under applicable consumer protection law.',
    ],
  },
  {
    title: 'Applying for jobs',
    paragraphs: [
      'The Apply button opens your own mail app or WhatsApp with a pre-filled message to the hiring manager. You review the message and send it yourself. We do not send applications for you, and a mail link cannot attach files automatically.',
      'Each application you send is recorded in your Account → My applications list.',
      'You are responsible for the content of your application and for any resume you attach. Do not send misleading, abusive or unsolicited bulk messages.',
      'We do not guarantee that a manager receives, reads or responds to your application.',
    ],
  },
  {
    title: 'Resume and documents',
    paragraphs: [
      'You may keep one current resume in PDF, DOC or DOCX format, up to 2 MB, in Account → Profile details. Uploading a new resume replaces the previous one.',
      'Your resume is stored in private storage. Only you can open or download it. It is not published, is not shown to other users, and is not readable by platform administrators.',
      'Resumes are deleted automatically 30 days after upload. Download a copy before then if you need one. You can delete your resume at any time.',
      'When you apply, the file name of your resume is recorded in your application history. You attach the file yourself in your mail app.',
    ],
  },
  {
    title: 'Your information',
    paragraphs: [
      'When you choose to apply, the information in the application (such as your name, phone number, email address and resume) is shared with the hiring manager of that vacancy.',
      'Do not put sensitive personal information (for example Aadhaar, PAN, bank details or medical records) in your profile, resume or applications unless an employer specifically asks for it.',
      'How we process personal data is described in our privacy policy. [Owner to publish the privacy policy and add its link here.]',
    ],
  },
  {
    title: 'AI Help',
    paragraphs: [
      'AI Help gives general career and job-application guidance. It is automated, may be wrong or out of date, and is not legal, medical, financial or professional advice. Check important information yourself before you act on it.',
    ],
  },
  {
    title: 'Acceptable use',
    paragraphs: [
      'You must not: scrape, copy or resell listings; share confidential vacancy details or manager contacts with others; use contact details to send spam, harassing or unsolicited bulk messages; create several accounts to obtain free access; attempt to bypass the subscription, access other users\' data or interfere with the service; or upload malicious files or false information.',
      'We may suspend or close accounts that break these terms. Where a breach causes a loss to us or to others, we may refuse a refund for the affected period, subject to applicable law.',
    ],
  },
  {
    title: 'Notifications and availability',
    paragraphs: [
      'We send in-app notifications about new or updated vacancies and about your account. The service is provided on a best-effort basis. It may be unavailable during maintenance or because of third-party services, such as Razorpay, Supabase or your mobile network.',
    ],
  },
  {
    title: 'Support',
    paragraphs: [
      'Ask questions or report problems through a support ticket in the App. We aim to respond within a reasonable time, but we do not guarantee a response time. For payment problems, include your payment ID or UTR.',
    ],
  },
  {
    title: 'Intellectual property',
    paragraphs: [
      'The App, including its design, branding, logo and the compilation of listings, belongs to us or our licensors. We give you a personal, non-transferable licence to use the App for your own job search.',
      'You keep all rights in your resume and other personal content. You allow us to store and display that content only as needed to run the service for you.',
    ],
  },
  {
    title: 'Disclaimers and limitation of liability',
    paragraphs: [
      'To the extent permitted by law, the App is provided "as is" and "as available". We are not responsible for hiring decisions, employer conduct, salary or other terms offered by employers, or losses that result from relying on a listing.',
      'To the extent permitted by law, our total liability for any claim is limited to the amount you paid us for the plan that gave rise to the claim. We are not liable for indirect or consequential loss.',
      'Nothing in these terms excludes liability that cannot be excluded under applicable law.',
    ],
  },
  {
    title: 'Ending your use',
    paragraphs: [
      'You may stop using the App at any time. To request deletion of your account, raise a support ticket. We may keep records that the law requires us to keep, such as payment and refund records.',
      'We may suspend or end your access if you break these terms.',
    ],
  },
  {
    title: 'Changes to these terms',
    paragraphs: [
      `We may update these terms. The date at the top of this document shows the latest version (last updated ${TERMS_LAST_UPDATED}). If you keep using the App after a change, you accept the updated terms.`,
    ],
  },
  {
    title: 'Governing law and disputes',
    paragraphs: [
      'These terms are governed by the laws of India. Subject to any mandatory rights you have as a consumer, the courts at Bengaluru, Karnataka, have jurisdiction. [Owner to confirm.]',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'Support: raise a support ticket in the App. Grievance and business contact: [owner to add name, email address and postal address].',
    ],
  },
]
