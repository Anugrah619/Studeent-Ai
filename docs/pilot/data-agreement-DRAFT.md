# DRAFT — not legal advice; a lawyer must review before use

**Pilot data agreement between [Institute] and Student AI** · draft of 24 Oct 2026 · one page

This is a starting point for counsel, written by the engineering team from what the software actually does. Every bracketed value is a decision for the parties, and every statement of law below must be checked against the current text of the Act and its Rules.

## 1 · Roles and purpose
- **[Institute]** collects its students' data and decides why it is used. It is the *Data Fiduciary* under India's Digital Personal Data Protection Act, 2023 (DPDP Act).
- **Student AI** processes that data only to provide the service — scores, marks-lost analysis, flags, revision plans and misconception diagnoses for the institute's mentors and students. For that it acts as the institute's *Data Processor*, on documented instructions.
- **Model training (§3) is a separate purpose of Student AI's own.** Counsel should confirm whether that makes Student AI a Data Fiduciary for it, and what basis it then needs.

## 2 · What leaves our system, and anonymisation
- Data is stored in [region / provider]. Each institute's rows are separated by database row-level security; staff see only their institute.
- The only third party that receives student-derived data is the reasoning model (Google Gemini, servers outside India). Each request carries an opaque reference (`S-1234`), question text, the options chosen and counts. **Never** a name, roll number, phone, date of birth, mentor or institute — enforced in code and by a test.
- This is *pseudonymisation*, not anonymisation: the reference can be linked back inside our system. Results files the institute uploads are retained as received, for audit — including any name or phone column they carry, so the institute should upload roll numbers and answers only.
- **Before the pilot** the reasoning account must be on a paid tier whose terms exclude training on and human review of our requests. Google's free tier permits both. [Confirm the tier and attach its terms.]
- Cross-border transfer is permitted except to countries the Central Government restricts (DPDP Act s.16). [Confirm none apply.]

## 3 · Model-training rights
- Student AI may keep de-identified reasoning traces (the pseudonymised request, the model's output, and a mentor's agree/disagree) to train and evaluate its own models, **only if the institute opts in here: [yes / no]**. Opting out does not change the service.
- No trained model or dataset will contain names, roll numbers or other direct identifiers. Traces are never sold or shared outside Student AI.
- The misconception taxonomy and question tags the institute adds become part of a shared, curated vocabulary; the institute's students' data does not.

## 4 · Retention and deletion
- Data is kept while the student is enrolled and for [6] months after they leave, then deleted. A student or parent may ask the institute for deletion sooner; Student AI completes it within [30] days of the institute's instruction.
- The event log is append-only by design; a deletion request overrides that. Derived state is rebuilt from what remains.
- Backups are kept for [30] days and then destroyed, so deleted data is gone from backups by then. The backup tool writes an *unencrypted* database dump, so the backup location must be an encrypted disk with access limited to [named people].
- At the end of the pilot the institute chooses: export (CSV) and deletion, or continuation under a full agreement.

## 5 · Students are minors: parental consent
- Almost every user is under 18. The DPDP Act (s.9) requires **verifiable consent of a parent or lawful guardian** before a child's data is processed, and bars processing likely to harm a child's well-being, and tracking, behavioural monitoring or targeted advertising directed at children.
- **The key question for counsel:** the product monitors academic performance. Whether the institute, and Student AI as its processor, fall within the exemption the DPDP Rules give educational institutions for monitoring in the interest of education is the single most important point to settle before the pilot.
- The institute collects and keeps the consent records; Student AI keeps no consent separately and processes no student the institute has not confirmed. [Attach the consent form.]
- By design students are not shown risk scores, flags or the misconceptions attributed to them; those are for mentors.

## 6 · Security and breach notification
- Passwords are stored hashed; student logins start on a temporary password that must be changed; the console is closed to student accounts; uploads and sign-in are rate-limited.
- Student AI will tell the institute of any personal-data breach **without delay and in any case within [24] hours** of becoming aware, with what is known, and will help it notify the Data Protection Board of India and each affected student or parent, as the Act requires of the Fiduciary. The Rules set the Board's timeline (a detailed report within 72 hours in the text we have read — confirm).
- Penalties under the Act are substantial (up to ₹250 crore for failing to take reasonable security safeguards). [Allocate liability.]

## 7 · Contacts
- Institute grievance officer: [name, email]. Student AI contact for data matters: [name, email].

*Signed for [Institute]: ______ · Signed for Student AI: ______ · Date: ______*
