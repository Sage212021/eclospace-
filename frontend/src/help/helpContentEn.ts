import type { HelpPole } from "./helpContent";

// English version of the in-app help. Mirrors helpContent.ts (French) key for
// key, so the contextual help follows the interface language.

export const HELP_CONTENT_EN: HelpPole[] = [
  {
    pole: "Getting started",
    intro: "The basics — valid on every screen.",
    entries: [
      {
        key: "g-connexion",
        title: "Signing in",
        purpose: "Enter the application with your username and password.",
        procedure: [
          "Open the application address (on a phone, you can “add to home screen” to open it like a real app).",
          "Enter your username, then your password, and confirm.",
          "If two-step security is enabled on your account, then enter the 6-digit code shown by your authenticator app.",
        ],
        stuck: [
          { q: "“Invalid credentials” although I'm sure of my password", a: "The phone keyboard sometimes adds a space or an automatic capital. The username is not case-sensitive (“noah” = “Noah”), but the password is: retype it letter by letter. As a last resort, an administrator (HR or Management) assigns you a new one." },
          { q: "Forgotten password", a: "There is no automatic email reset: ask an administrator to assign you a new one, then change it from your profile." },
        ],
      },
      {
        key: "g-circuit",
        title: "Understanding a book's journey",
        purpose: "Many screens are not separate folders but STAGES each book goes through, from manuscript to finished book.",
        procedure: [
          "A book moves stage by stage: reading committee → decision → contract → correction → layout → graphics → ISBN → proof (BAT) → printing → stock → sale → archiving.",
          "Each stage section (Committee, Correction, Layout, Proof…) shows the books CURRENTLY at that stage.",
          "To work: open the book in the list, do the stage's work (upload a file, fill in a detail…), then click “Validate this stage”.",
          "The book then moves to the next stage and the relevant person is notified.",
        ],
        stuck: [
          { q: "A book doesn't appear in my stage section", a: "It hasn't reached this stage yet: the previous stage must be validated first. It will appear automatically when the time comes." },
          { q: "“Validate this stage” is refused", a: "A required item is missing (a file, some information) or you don't have validation rights for this stage. The message tells you what's blocking." },
        ],
      },
      {
        key: "g-naviguer",
        title: "Finding your way around",
        purpose: "The left menu groups screens by department; expand a department to see its sections.",
        procedure: [
          "On a phone, open the menu with the ☰ button at the top left.",
          "Click a department to expand it, then a section to open the screen.",
          "Every department stays visible, even outside your scope — but they only open for the relevant people.",
        ],
        stuck: [
          { q: "“Access denied” when opening a section", a: "Normal: this screen isn't part of your department. The structure is visible to all; the data is not. If you think you should have access, check with Management or HR." },
        ],
      },
      {
        key: "g-email",
        title: "Sending a document by email",
        purpose: "The app doesn't send “free” emails: it sends specific DOCUMENTS (invoice, royalty statement, newsletter) or a signing link.",
        procedure: [
          "An invoice or a royalty statement: in “Finance & accounting”, open the document and click “Send by email”.",
          "A window opens: the recipient (often pre-filled), a message, and a preview. Adjust, then “Send”.",
          "The internal newsletter: from “News bulletin”, “Send” button (sent to all staff).",
          "An author quote: its signing link is emailed to the author from the quote.",
        ],
        stuck: [
          { q: "The email doesn't seem to have been sent", a: "Sending depends on the mail server configuration (on the hosting side). If it isn't set up, the send is only logged, not actually delivered. Report it to the administrator." },
          { q: "I'd like to write a free email to a colleague", a: "The app doesn't allow it: it only sends official documents. For an internal message, use the notice board or the newsletter." },
        ],
      },
      {
        key: "g-couleurs",
        title: "Colour codes and messages",
        purpose: "Colours always mean the same thing throughout the app.",
        procedure: [
          "Gold: positive, in progress, highlighted. Navy: done / validated.",
          "Orange: late or to be confirmed. Red: critical, error or deletion.",
          "Figures are in a monospaced font (aligned); a red or orange figure is an alert.",
        ],
        stuck: [
          { q: "An error message appears", a: "Errors are explicit: they state the value concerned and what to do (e.g. “Outstanding limit exceeded: 4.9M for a 4.0M ceiling”). Read the message — it tells you what to do." },
        ],
      },
      {
        key: "g-recherche",
        title: "Search, notifications and presence",
        purpose: "Find a book/author, follow what concerns you, see who's working.",
        procedure: [
          "The search bar at the top finds a book, an author or an ISBN.",
          "The bell 🔔 lists your notifications; click one to open the related item.",
          "The “online” indicator shows how many people are connected (without revealing who, in other departments).",
        ],
        stuck: [
          { q: "I can't see who is online", a: "That's intentional: we never show who is connected in another department, to preserve confidentiality." },
        ],
      },
      {
        key: "g-profil",
        title: "My account and language",
        purpose: "Change your password and the interface language.",
        procedure: [
          "Open your profile via the initial at the top right.",
          "Choose the language: French or English.",
          "To change your password, the old one is required, and the new one must meet a minimum complexity (at least 8 characters, one capital, one digit).",
        ],
        stuck: [
          { q: "Enabling two-step security (2FA)", a: "This is set up with Management: mention it to your administrator." },
        ],
      },
    ],
  },
  {
    pole: "Home",
    entries: [
      {
        key: "dashboard",
        title: "Dashboard",
        purpose: "The overview of the publishing house: key indicators and editorial pipeline, in real time.",
        procedure: [
          "Read the key indicators (works in progress, total, sales, stock, out-of-stock, users…).",
          "The “editorial pipeline” shows how many works are at each stage of the journey.",
          "Click a highlighted announcement to open it; today's birthdays may appear (without the year).",
        ],
        stuck: [
          { q: "An indicator (revenue, HR) doesn't appear", a: "It's reserved for an authorised profile (finance, HR). Its absence is not a fault: it's data compartmentalisation." },
        ],
      },
      {
        key: "suivi",
        title: "Book tracking",
        purpose: "See at a glance where each book stands in production — handy when an author calls to ask.",
        procedure: [
          "The list shows works that have entered production, with their current stage and a progress percentage.",
          "Type a title, author or number in the search bar to find a specific work.",
          "Click a work: a status-light timeline unfolds and shows each stage of the journey (green = done, gold = current stage, grey = upcoming).",
        ],
        stuck: [
          { q: "A recent work isn't in the list", a: "Tracking only shows works already in production (from layout onwards). A manuscript still in reading or under contract doesn't appear yet: follow it from “Manuscripts”." },
          { q: "The percentage doesn't move", a: "It only advances when the work actually changes stage in the journey. It's the relevant pole (production, proof, printing…) that moves the stage forward." },
        ],
      },
      {
        key: "mes-rapports",
        title: "My weekly reports",
        purpose: "Write and find your weekly reports.",
        procedure: [
          "Select the week concerned.",
          "Write your report and save it.",
          "Find the history of your previous reports by changing week.",
        ],
        stuck: [
          { q: "I can't find an old report", a: "Check the selected week: reports are sorted by date." },
        ],
      },
    ],
  },
  {
    pole: "Editorial",
    entries: [
      {
        key: "ed-manuscrits",
        title: "Manuscripts",
        purpose: "The entry point of every work: submission, record, and tracking through the whole journey.",
        procedure: [
          "To submit a new manuscript: “+ Add” button, fill in title, author, genre, collection…",
          "Click a manuscript to open its record: current stage, documents, history.",
          "From the record, move the journey forward with “Validate this stage” once the stage's work is done.",
        ],
        stuck: [
          { q: "The “+ Add” button doesn't appear", a: "Creation requires editorial entry rights; without them, the screen is read-only." },
          { q: "A collection/genre is missing from the form", a: "Add it first under “Domains & collections”; it will then appear in the dropdown." },
        ],
      },
      {
        key: "ed-comite",
        title: "Reading committee",
        purpose: "Journey stage: have received manuscripts evaluated by readers, and gather their reviews.",
        procedure: [
          "The list shows the manuscripts currently at the reading committee.",
          "Open a manuscript and assign one or more readers, with a deadline.",
          "Each reader submits their evaluation under “My reviews”; track the submitted reviews here.",
          "When all expected reports are in, the stage can move to the editorial decision (a notification signals it).",
        ],
        stuck: [
          { q: "A reader doesn't see their assignment", a: "Check that they were assigned to THIS manuscript; they'll find it under their “My reviews” section." },
          { q: "I can't move to the next step", a: "As long as all expected reports aren't submitted, the stage stays open." },
        ],
      },
      {
        key: "ed-mes-lectures",
        title: "My reviews",
        purpose: "For a reader: your reading assignments and the submission of your evaluations. (Not a file upload: you fill in a structured evaluation.)",
        procedure: [
          "The list shows your assignments, each with a deadline and a status.",
          "Click “Evaluate” to open the grid.",
          "Score each criterion (each has a coefficient); an indicative overall score appears (recalculated and validated by the server on submission).",
          "Choose a Recommendation (accept / minor corrections / major corrections / rewrite / new expertise / reasoned rejection) and write the general assessment.",
          "Click “Submit my report”. Message: “Evaluation submitted successfully”.",
        ],
        stuck: [
          { q: "Can I download a reading report?", a: "Yes: once submitted, you can download/print your report (“Download my report”), and you may also attach an external file (“Attach the report (file)”). The evaluation itself is a form (scores + recommendation + comment)." },
          { q: "My list is empty", a: "No assignment is allocated to you at the moment; the reading committee assigns them." },
          { q: "I can no longer edit a submitted evaluation", a: "Once submitted, it is saved. Check with the committee lead if a correction is needed." },
        ],
      },
      {
        key: "ed-direction",
        title: "Editorial management",
        purpose: "Journey stage: decide each manuscript's fate (accepted, rejected, to revise) based on the committee's reviews.",
        procedure: [
          "The list shows manuscripts awaiting an editorial decision.",
          "Open a manuscript: review the summary of the submitted reviews.",
          "Make the decision and validate the stage; an accepted manuscript moves to contracting.",
        ],
        stuck: [
          { q: "I can't decide", a: "The decision requires the relevant right; without it, the screen stays read-only." },
        ],
      },
      {
        key: "ed-correction",
        title: "Editorial correction",
        purpose: "Journey stage: correction and rewriting entrusted to proofreaders.",
        procedure: [
          "The list shows works in correction.",
          "Track the correction tasks and their progress; a proofreader sees and handles their own tasks.",
          "When correction is complete, “Validate the correction” moves the work forward.",
        ],
        stuck: [
          { q: "A proofreader can't see their tasks", a: "They only see the ones assigned to them: check the assignment." },
        ],
      },
      {
        key: "ed-catalogue-ref",
        title: "Domains & collections",
        purpose: "Manage the categories that classify works (domains, collections) and feed the menus.",
        procedure: [
          "Create or edit a domain / a collection (editorial administration rights required).",
          "These lists then appear in the dropdowns when submitting a manuscript.",
        ],
        stuck: [
          { q: "A collection is missing from a form", a: "Add it here; it will be available immediately in the forms." },
          { q: "I can't change anything", a: "Management requires administration rights; otherwise it's read-only." },
        ],
      },
      {
        key: "ed-archives",
        title: "Archives",
        purpose: "Find works that have reached the end of the journey (archived).",
        procedure: [
          "Browse the list of archived works.",
          "Open a record to view its full history.",
        ],
        stuck: [
          { q: "A work has disappeared from the active lists", a: "It's probably archived: look for it here. Nothing is ever permanently deleted (logical deletion)." },
        ],
      },
    ],
  },
  {
    pole: "Production",
    intro: "These sections are the manufacturing stages: each lists the works that have reached that stage; you open one, do the work, then “Validate this stage”.",
    entries: [
      {
        key: "pr-maquette",
        title: "Layout & typesetting",
        purpose: "Journey stage: the interior layout of the work.",
        procedure: [
          "The list shows works in layout.",
          "Open a work, upload/update its layout files (each upload creates a new tracked version).",
          "When the layout is ready, validate the stage.",
        ],
        stuck: [
          { q: "I don't have access to Layout", a: "This screen requires a “Production” right. Legal, HR… don't have access: that's compartmentalisation by role." },
        ],
      },
      {
        key: "pr-infographie",
        title: "Graphics & covers",
        purpose: "Journey stage: the cover and graphic elements.",
        procedure: [
          "Open the work at the graphics stage.",
          "Upload the cover; the app generates a lightweight version for on-screen display (the print version keeps its higher quality).",
          "Track the successive versions, then validate the stage.",
        ],
        stuck: [
          { q: "The cover looks heavy", a: "On screen it's the lightweight version that's shown; the print-quality original is kept separately." },
        ],
      },
      {
        key: "pr-isbn",
        title: "ISBN & legal deposit",
        purpose: "Journey stage: assign the ISBN and prepare the metadata and legal deposit.",
        procedure: [
          "Open the work at this stage.",
          "Assign an ISBN from the available pool and fill in the required metadata.",
          "Validate the stage.",
        ],
        stuck: [
          { q: "I can't reuse an ISBN", a: "That's a non-negotiable rule: an assigned ISBN is never reused, even after cancellation." },
          { q: "No ISBN available", a: "The pool is exhausted: a new ISBN range must be recorded before any can be assigned." },
        ],
      },
      {
        key: "pr-bat",
        title: "Proof (BAT) & quality control",
        purpose: "Journey stage: the “Good to Print” (BAT), the final green light before printing.",
        procedure: [
          "Open the work at the proof stage.",
          "Upload the proof, record the quality control, and compare versions if there are several cycles.",
          "When all is good, sign the proof: signing LOCKS the files and passes the file to printing.",
        ],
        stuck: [
          { q: "“The proof is signed: locked”", a: "Once signed, the proof and its files are frozen, to guarantee that printing matches exactly what was validated. Any redo must be justified and notified to management." },
          { q: "I can't sign", a: "Signing requires proof-validation rights; uploading and control require entry rights." },
        ],
      },
      {
        key: "pr-impression",
        title: "Printing",
        purpose: "Journey stage: manufacturing, from the locked file to receiving the copies.",
        procedure: [
          "Open the work at the printing stage: the file comes from the signed proof.",
          "Create/track the print order.",
          "On receipt, record the copies: they enter stock.",
        ],
        stuck: [
          { q: "I can't launch printing", a: "The proof must be signed first: that's what passes the locked file to printing." },
        ],
      },
    ],
  },
  {
    pole: "Sales",
    entries: [
      {
        key: "co-stock",
        title: "Stock & warehouse",
        purpose: "Know and manage the copies: inbound, outbound, transfers, locations and alerts.",
        procedure: [
          "View quantities by title and by location.",
          "To move stock: “Record the movement” (inbound, outbound or transfer).",
          "For a new location: “+ Location”.",
          "Watch the alert thresholds (orange) and out-of-stock (red).",
        ],
        stuck: [
          { q: "A title is out of stock (red)", a: "Availability is zero or below the alert threshold: a reprint or a stock inbound should be considered." },
          { q: "Stock doesn't match a sale", a: "Sales and stock are linked automatically (atomic operation): a discrepancy shouldn't appear; if it persists, report it." },
        ],
      },
      {
        key: "co-ventes",
        title: "Sales & commercial",
        purpose: "Customers, orders, discounts, deliveries, returns, credit notes and direct sale.",
        procedure: [
          "Create an order: “Create the order”. The outstanding-balance check verifies the customer's ceiling.",
          "For a direct sale (including mobile money): “Cash in”; you can add a mixed payment method.",
          "Manage deliveries, returns and credit notes; add a point of sale with “+ new point of sale”.",
        ],
        stuck: [
          { q: "“Outstanding limit exceeded”", a: "The amount the customer owes would exceed their authorised ceiling. The message gives the outstanding balance and the ceiling. A payment is needed, or raise the customer's ceiling." },
          { q: "“Accounting period closed”", a: "You can no longer write into a frozen period. Contact finance for the period concerned." },
          { q: "“Cannot add the point of sale”", a: "A required piece of information is missing or duplicated; the message says which one." },
        ],
      },
    ],
  },
  {
    pole: "Legal & Finance",
    entries: [
      {
        key: "jf-contrats",
        title: "Contracts & royalties",
        purpose: "Journey stage: draw up the contract of an accepted work and set the royalty terms.",
        procedure: [
          "The list shows works in contracting.",
          "Open the work, draw up the contract (terms, royalty rate) and track its signing.",
          "Validate contracting: the work moves to correction. Royalties will then be computed from sales.",
        ],
        stuck: [
          { q: "A royalty calculation looks wrong", a: "Royalties are recomputed automatically from sales and returns: first check the work's sales/credit notes." },
        ],
      },
      {
        key: "jf-finance",
        title: "Finance & accounting",
        purpose: "Invoices, receipts, royalty statements, schedules, closings and accounting exports.",
        procedure: [
          "View invoices (immutable once issued) and record receipts (“Cash in” / “Validate”).",
          "Send an invoice or a statement by email: “Send by email” → recipient + message + preview → “Send”.",
          "Generate a royalty statement: “Generate a royalty statement”.",
          "Close an accounting period; export for the external accounting software/firm.",
        ],
        stuck: [
          { q: "I can't edit an invoice", a: "Intentional: an issued invoice is immutable and numbered in a secure series. To correct it, a credit note is issued rather than editing it." },
          { q: "The account codes in the export", a: "The chart of accounts provided is indicative, not certified: to be validated by your accountant before any real filing." },
          { q: "“already settled”", a: "The receipt has already been recorded for this document: no need to do it again." },
        ],
      },
    ],
  },
  {
    pole: "Administration",
    entries: [
      {
        key: "ad-rh",
        title: "Human resources",
        purpose: "Staff records, attendance, absences, and payroll (if enabled).",
        procedure: [
          "Add a staff member (“+ Staff member”); record a departure (“Record a departure”).",
          "Handle absence requests: “Validate” or “Reject”.",
          "Sensitive data is edited via “Edit confidential data” (dedicated right).",
          "If internal payroll is enabled, run a campaign (“+ Campaign”) and produce payslips; otherwise, export for external payroll.",
        ],
        stuck: [
          { q: "I can't see birth dates / age", a: "The birth date stays internal (HR) and age is never shown; only a “birthday today” note may appear, without the year." },
          { q: "The HR screens are empty for me", a: "They're reserved for HR and Management: intended compartmentalisation." },
        ],
      },
      {
        key: "ad-users",
        title: "Users & roles",
        purpose: "Create accounts and assign roles (permissions).",
        procedure: [
          "“+ New account” → fill in the username and email → “Create the account”.",
          "On an account: “+ Assign a role…” then “Assign”; repeat for several roles.",
          "Other actions: “Reset password”, “Suspend the account”, “Delete the account”.",
          "“Sign in as” lets you view the app with another person's rights (action logged in the journal).",
        ],
        stuck: [
          { q: "“This email / username is already used”", a: "A value must be unique. If it belonged to a DELETED account, it's freed automatically; if it belongs to an ACTIVE account, choose another one." },
          { q: "A profile has an access it shouldn't have", a: "Each role adds its access: it's often a cumulated role. Prefer one role per job, and remove the extra role." },
        ],
      },
      {
        key: "ad-rights",
        title: "Rights & departments",
        purpose: "See and adjust, department by department, which rights each role grants.",
        procedure: [
          "Browse the rights matrix by department and by role.",
          "Adjust a role's permissions (user administration rights required).",
        ],
        stuck: [
          { q: "Understanding an unexpected access", a: "Spot here which role carries the right in question, then tighten it, or remove the extra role at the account level." },
        ],
      },
      {
        key: "ad-parametres",
        title: "Settings",
        purpose: "General settings (house identity, options, default language…).",
        procedure: [
          "Adjust the available settings according to your rights, and save.",
        ],
        stuck: [
          { q: "A setting is greyed out", a: "It requires settings administration rights." },
        ],
      },
      {
        key: "ad-diagnostics",
        title: "System diagnostics",
        purpose: "Check the technical state of the app (reserved for the general administrator).",
        procedure: [
          "View the technical indicators and the state of the services.",
        ],
        stuck: [
          { q: "I don't have access", a: "This screen is reserved for the general administrator." },
        ],
      },
    ],
  },
  {
    pole: "Internal communication",
    entries: [
      {
        key: "cm-actualites",
        title: "News feed",
        purpose: "A timeline of what's happening in the house (announcements, events, deadlines).",
        procedure: [
          "Scroll the feed; each item shows its date and a preview.",
          "Click an item to open the related announcement or calendar.",
        ],
        stuck: [
          { q: "The feed is empty", a: "There's no news yet, or none is addressed to you." },
        ],
      },
      {
        key: "cm-babillard",
        title: "Notice board",
        purpose: "Read and publish internal announcements.",
        procedure: [
          "Read the published announcements.",
          "To publish (communication entry rights): write the announcement and publish it to its audience.",
          "Set your notification preferences to choose what alerts you.",
        ],
        stuck: [
          { q: "I can't publish", a: "Publishing requires communication entry rights." },
        ],
      },
      {
        key: "cm-evenements",
        title: "Events planning",
        purpose: "The house's highlights, in List or Calendar view, with status and poster.",
        procedure: [
          "Switch between “📋 List” (detailed) and “📅 Calendar” (the whole year at a glance).",
          "HR and Management: “+ Add” or “Edit” an event; change the status (upcoming / to confirm / held / not held); “Add a poster”.",
          "In the calendar, click a coloured day to see that day's events.",
        ],
        stuck: [
          { q: "I can't edit an event", a: "Management is reserved for HR and Management; others view only." },
          { q: "An event colours too many days", a: "It covers its whole date range: open it with “Edit” and check its start and end dates." },
        ],
      },
      {
        key: "cm-calendrier",
        title: "Shared calendar",
        purpose: "A shared monthly calendar (events, today's birthdays).",
        procedure: [
          "Navigate month by month.",
          "Publish an event if you have entry rights; the relevant audience is notified.",
        ],
        stuck: [
          { q: "Difference with Events planning", a: "The Planning tracks the major annual highlights (status + poster); the Shared calendar is a more general monthly diary." },
        ],
      },
      {
        key: "cm-bulletin",
        title: "News bulletin",
        purpose: "Compose and send the internal bulletin (a digest of announcements and events).",
        procedure: [
          "Compose a bulletin (communication entry rights) and preview it.",
          "Click “Send”: the bulletin goes by email to all staff.",
          "Note: sending is FINAL — after sending, the bulletin can no longer be edited.",
        ],
        stuck: [
          { q: "The send didn't go out", a: "Email sending depends on the mail server configuration; without it, it's only logged." },
          { q: "I want to fix a sent bulletin", a: "Not possible: a sent bulletin is frozen. Send a new one with the correction." },
        ],
      },
    ],
  },
  {
    pole: "Steering",
    entries: [
      {
        key: "pi-direction",
        title: "General management",
        purpose: "The steering view: management indicators and recommendations to handle.",
        procedure: [
          "View the steering indicators.",
          "Generate the proposed items (“Generate”) and handle the recommendations (“Confirm”).",
        ],
        stuck: [
          { q: "Reserved for management", a: "This screen requires a “management” viewing right." },
        ],
      },
      {
        key: "pi-rapports",
        title: "Reports & statistics",
        purpose: "The house's analyses and statistics.",
        procedure: [
          "View the available reports; “Generate” a report for a period.",
          "Create an analysis (“+ Analysis”) and save it if you have the right.",
        ],
        stuck: [
          { q: "I don't have access to the reports", a: "Reserved for steering profiles (Management, Editorial Management, Finance, HR)." },
        ],
      },
      {
        key: "pi-journal",
        title: "Activity log",
        purpose: "The record of everything done in the app (audit).",
        procedure: [
          "Browse the history: who did what, when, on which item.",
          "Filter to find a specific action.",
        ],
        stuck: [
          { q: "Can a log line be deleted?", a: "No: the log is tamper-proof (append-only), even for an administrator. It's a traceability guarantee." },
        ],
      },
    ],
  },
];
