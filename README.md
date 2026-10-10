# SellerOne

## Overview

SellerOne is a modern, cloud-native mobile and web application designed specifically
for sole traders, online sellers, social commerce entrepreneurs, and home-based
businesses. Available through the Google Play Store and Apple App Store, the
platform delivers a complete business management ecosystem that combines
Inventory Management, Online Order Processing, Customer Relationship
Management (CRM), and Integrated Accounting into a single, easy-to-use solution.
Built with a plug-and-play architecture, SellerOne enables online sellers to manage
their entire business operation from a smartphone, tablet, or computer without
requiring complex accounting knowledge or expensive enterprise software.

## Vision

To empower online sellers and small business entrepreneurs with an affordable,
intelligent, and fully integrated business management platform that simplifies
operations, improves customer engagement, and supports sustainable business
growth.

## Target Users

**Sole Traders**
- Facebook marketplace sellers
- Facebook Live sellers
- TikTok Shop sellers
- Instagram sellers
- Messenger-based sellers
- Home-based online businesses
- Resellers and distributors
- Small-scale e-commerce entrepreneurs

## Core Features

### Owner-only Product Information Sheets

Catalogue cards include **View Product** and, for Workspace Owners only,
**Edit Product**. Owners alone create products, modify product/variant fields,
and manage BOM catalogue classifications/structures. Admins, Staff and
Inventory Controllers retain their authorised inventory receiving, movements
and reconciliation, but cannot modify catalogue records. This restriction is
enforced by the platform API, not just hidden controls.

The Product Information Sheet edits every existing variant, specifications,
descriptions, prices, UOM and stock-planning levels, variant status, up to 20
unique categories, and up to three product images. Images are authenticated,
PNG/JPEG/WebP only, at most 5 MB and 4096 x 4096 pixels per image, single-frame,
decoded/re-encoded as WebP with metadata stripped. Categories and images are
optional and do not change the standard catalogue or stock classifications.

Required fields are product name and, per variant, name, SKU, UOM, currency,
unit cost and minimum stock. Selling price remains optional (blank means manual
pricing; zero is an explicit free price); medium/maximum targets, descriptions,
specifications, categories and images remain optional. Inline validation and
actionable warnings disable **Save Changes** until valid. Completion status is
**Missing Required Information**, **In Progress** for valid unsaved changes, or
**Complete** for a valid saved record.

**Cancel Changes** and **Reset** discard edits after confirmation. Owner drafts
autosave on the current device/browser, keyed to the signed-in user and product,
and recover in edit mode; drafts do not modify server data. Storage failures are
explicitly reported. Unsaved edits warn on link navigation or browser unload.
Successful saves clear the draft and show confirmation. Drafts whose saved
product version has changed are not automatically applied; concurrent edits
are rejected with a reload/review message rather than overwriting newer data.
The full-sheet API
`PUT /products/:id/sheet` commits product, all variants, categories and images
atomically, rolling back validation failures. Historical UOM locks and currency
restrictions remain enforced. Current quantities are read-only on the sheet;
use inventory operations to change physical stock.

### Controlled Product Retirement

Owners and Admins can **Delete Product**, **Archive Product** or **Deactivate
Product** from each catalogue card's contextual ellipsis menu and product details.
Cards always display a labelled, colour-coded **Lifecycle Status** badge.
The menu groups View Product, Owner-only Edit Product, View Status History,
and authorised retirement/restore actions. It supports keyboard navigation,
Escape, outside-click dismissal and focus return after cancelling a dialog.
Admins have this narrow
lifecycle permission only; ordinary catalogue editing remains Owner-only.
Delete is soft retirement, never permanent removal. A predefined business
reason and explicit confirmation are mandatory; **Other** requires comments.
Archive sets Archived; Deactivate sets Discontinued. Delete maps End of Life,
Phase-Out and Discontinued reasons to those statuses; other reasons archive.
Phase-Out remains orderable. End of Life, Discontinued and Archived block new
orders and checkout purchases, while existing orders and inventory operations
continue normally. Product details, images, categories, BOMs and transactions
are retained. Restore returns a product to Active with a required explanation
without changing individual variant status.

The dedicated `GET/POST /product-lifecycle/:id` endpoint exposes history and
validated transitions. Direct product status changes through PATCH or the
information sheet are rejected. Status, product availability, audit events and
stakeholder notifications commit atomically, with stale-status checks and
idempotent transaction keys. Product details show the status history, including
product ID/name, reason, action, previous/new status, acting user ID/name/role,
timestamp, comments and transaction ID.

Active Owners, Admins and Inventory Controllers at the time of the change
receive in-app lifecycle alerts independently of inventory-alert recipient
preferences. The bell merges pending unread stock and lifecycle notifications.
Viewing acknowledges only the current user's alert and refreshes its unread
badge. No email or permanent deletion occurs. Legacy inactive products appear
as Archived without fabricated historical audit events.

### Guided Order Processing

Order creation is organised into Customer & delivery, Items & pricing, and
Review & create sections, with live line totals and an order total. Creation
opens order details for the next payment step; it does not reserve stock.
The inbox provides quick stage filters, clear/reset and refresh controls, and
role-aware next-action links. Order details highlight the next required action
and show lifecycle progress. Missing delivery details are surfaced before
dispatch, while communication and tracking tools are expandable.

The workflow remains Received → payment verified + stock reserved → packing →
shipped + stock deducted → delivered → completed + sale recorded.
Only Owners/Admins verify or reject payment and record manual refunds.
Inventory availability is rechecked atomically by the server; the interface
does not bypass shortages, shipping requirements, or invoice-printing rules.

### Workspace Header Search

The sidebar **My workspace** button opens the current-workspace menu. Owners and
Administrators can view saved business details and open Business details,
Settings or Team & access. Other roles see their role and their workspace home,
without restricted settings links or requests. The menu closes on navigation,
outside click, focus leaving the menu or Escape. SellerOne currently has one
workspace; this menu does not switch accounts or create additional workspaces.

Use the header **Search** button, **Ctrl+K**, or **Command+K** to find products
by name, variant name or SKU; orders by order number, customer or external ID;
customers by name, email or phone; and accessible workspace pages. Results link
to the corresponding record. When more than eight matches exist in a record
group, **View all** opens the full list with the search filter retained.
Search respects workspace page permissions, including specialist roles and the
optional Raw Material BOM setting. Escape, the close button or a backdrop click
closes the dialog. Loading failures are shown with a retry action.

### 1. Inventory Management

Simplify inventory tracking and stock control with real-time visibility.

**Features**
- Inventory Stock-In
- Inventory Stock-Out
- Product Catalogue Management
- SKU and Barcode Management
- Batch and Lot Tracking
- Inventory Adjustment
- Stock Transfer Between Locations
- Low Stock Alerts
- Reorder Point Notifications
- Product Variants Management
  - Size
  - Colour
  - Packaging
- Inventory Valuation
- Real-Time Stock Monitoring
- Inventory History and Audit Trail

**Benefits**
- Prevent stock shortages
- Eliminate manual inventory tracking
- Improve inventory accuracy
- Reduce overstocking and stock losses

### 2. Social Commerce Order Processing

Manage channel-attributed orders and shareable checkout submissions through a
unified workflow. Live social-platform API connections are not yet configured.

**Supported Channels**
These channels are supported for manual attribution and normalized imports,
not automatic capture from their native APIs:

- TikTok Shop
- Facebook Marketplace
- Facebook Page
- Facebook Messenger
- Instagram
- Manual Order Entry
- Shareable Order Links

**Features**
- Customer Order Capture
- Social Media Order Integration
- Cart and Checkout Links
- Order Confirmation
- Invoice Generation
- Payment Validation
- Order Fulfilment
- Shipping Management
- Delivery Tracking
- Order Status Monitoring

**Order Workflow**

1. Order received
2. Payment verification
3. Inventory reservation
4. Packing
5. Shipping
6. Delivered
7. Completed

**Benefits**
- Faster order processing
- Reduced manual encoding
- Improved customer experience
- Order visibility from end to end

### 3. Customer Relationship Management (CRM)

Build stronger relationships with customers and increase repeat purchases.

**Features**
- Customer Profile Management
- Customer Purchase History
- Lead and Prospect Management
- Customer Segmentation
- Messaging and Follow-Ups
- Customer Support Tracking
- Loyalty Program Management
- Rewards and Discount Management
- Customer Notes and Preferences
- Customer Lifetime Value Analysis

**Customer Analytics**
- New Customers
- Returning Customers
- Top Buyers
- Customer Retention Rate
- Average Purchase Value
- Sales by Customer

**Benefits**
- Improve customer satisfaction
- Increase repeat sales
- Strengthen customer loyalty
- Create personalised marketing campaigns

### 4. All-in-One Accounting System

Designed specifically for online sellers with simplified accounting workflows and
automated bookkeeping.

**Features**
- Automated Journal Entries
- Sales Recording
- Expense Management
- Accounts Receivable
- Accounts Payable
- Cash Flow Monitoring
- Bank Reconciliation
- Financial Reporting
- Tax Reporting Support
- Profit and Loss Statement
- Balance Sheet
- General Ledger

**Accounting Automation**
The system automatically records accounting transactions when:
- Inventory is purchased
- Orders are completed
- Payments are received
- Delivery fees are paid
- Expenses are incurred
- Refunds are processed

**Financial Dashboard**
- Total Revenue
- Total Expenses
- Gross Profit
- Net Profit
- Cash Balance
- Outstanding Receivables
- Monthly Sales Trends

**Benefits**
- No accounting expertise required
- Reduced bookkeeping effort
- Accurate financial records
- Real-time business performance visibility

## Cloud-Native Architecture

SellerOne is built using a modern cloud-native architecture that supports scalability,
reliability, and high availability.

**Architecture Principles**

**Mobile First**
- Android Application
- iOS Application
- Responsive Web Portal

**Cloud Native**
- Microservices Architecture
- Containerized Deployment
- Auto Scaling
- High Availability
- Multi-Tenant Design

**API-Driven Platform**
- REST APIs
- Event-Driven Integration
- Third-Party Connectivity
- Social Commerce Integration

**Security**
- Role-Based Access Control (RBAC)
- Multi-Factor Authentication (MFA)
- Data Encryption
- Audit Logging
- Secure Cloud Storage

## Analytics Dashboard

Business owners can monitor their entire business from a single dashboard.

**Operational Metrics**
- Orders Today
- Orders This Month
- Pending Orders
- Completed Orders
- Cancelled Orders

**Inventory Metrics**
- Total Products
- Low Stock Items
- Out-of-Stock Items
- Inventory Value

**Customer Metrics**
- Active Customers
- New Customers
- Repeat Customers
- Customer Growth

**Financial Metrics**
- Daily Sales
- Monthly Revenue
- Gross Profit
- Net Profit
- Cash Position

## Future Enhancements

- AI-Powered Sales Forecasting
- Smart Inventory Replenishment
- Chatbot Customer Support
- Digital Wallet Integration
- QR Code Payments
- Marketplace Integrations
- Affiliate Marketing Module
- Loyalty Points System
- Multi-Warehouse Support
- Multi-Vendor Marketplace Features

## Key Value Proposition

SellerOne helps online sellers manage inventory, orders, customers, and accounting in
one unified platform. By combining social commerce integration, automated
bookkeeping, and cloud-native scalability, the solution enables entrepreneurs to focus
on growing their business while reducing operational complexity and administrative
workload.

## Microservice Repository

This repository contains starter services for the SellerOne business domains:

| Service | Default port | Health check |
| --- | ---: | --- |
| Inventory | 3001 | `GET /health` |
| Orders | 3002 | `GET /health` |
| Customers | 3003 | `GET /health` |
| Accounting | 3004 | `GET /health` |

The MVP includes a React web application and an authenticated platform API for
the requested login, registration, dashboard, product, inventory, order,
customer, sales, expense, accounting, report, settings, and user-management
screens. Inventory uses persistent SQLite storage, FIFO valuation, and prevents
negative stock. Orders and sales are recorded independently; creating an order
now reserves inventory after payment verification and deducts it at dispatch.
Live channel, payment-gateway, messaging-provider, and carrier integrations
remain outside the local implementation.

### Requirements

- Node.js 24 or newer
- npm 11 or newer
- Docker and Docker Compose (optional, for containerized startup)

### Run the MVP locally

Install dependencies and build the application:

```sh
npm ci
npm run build
```

Run the authenticated API and serve the built web UI at `http://localhost:3100`:

```sh
npm run start:platform
```

For local UI development, run `npm run dev:platform` and `npm run dev:web` in
separate terminals. The Vite server proxies `/api` requests to the platform API.

On the first visit, create the workspace owner through the one-time setup
screen. Additional users must be invited by an owner or admin and complete
registration using the invitation link. Only Owners can assign or change roles.
Admins may invite Staff by omitting `role`; an explicit role assignment is
rejected for non-Owners, including assignments submitted directly to the API.
Without SMTP, local development
displays a reset link directly in the browser and explicitly states that no
email is sent. The link works only for an active matching account. Configure `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` to send reset emails;
set `APP_URL` to the public application base URL if it differs from the request
origin. Password reset email delivery is required when `NODE_ENV=production`.
Use HTTPS in production so session cookies remain protected.
The login form supports browser/password-manager autofill using the work email
as the username and the saved current password. Suggestions depend on saved
credentials and browser settings; SellerOne does not store passwords in browser
storage.
The ellipsis beside the sidebar account name opens account options. Owners and
admins can open workspace settings; all users can sign out. Click outside the
panel or press Escape to close it. Sign-out errors are shown without redirecting.

### Workspace roles and invitation permissions

Owner-only selectors appear in **Invite a teammate**, pending invitations, and
the team list. Staff and Admin remain available alongside:

| Role | Enforced access |
| --- | --- |
| Inventory Controller | Read-only product/variant catalogue; inventory receipts, issues, transfers, adjustments/reconciliation, locations, batches, movements, valuation, and stock alerts; optional BOM read-only |
| Order Processing Specialist | Order capture, payment submission, shipping details, fulfilment/status transitions, invoice printing, and order communications; read-only product/location/stock/customer lookup for order processing |
| Customer Relations Representative | Customer records, contacts, support/feedback notes, social links, and existing customer order-history summaries |

Specialized roles cannot access general dashboards, finance, reports, workspace
settings, or team management. Each starts on its permitted module. All users
retain their own account details, password, picture, and personal social links.
Stock notifications are delivered only to configured recipient roles/users;
every signed-in role can open its own assigned notifications, without gaining
inventory or order permissions.
Customer relations does not grant order mutations or access to full order
details. There is no new support-ticket or enquiry integration.
Existing Staff access is preserved; this change does not convert Staff into a
restricted role. Owners/Admins retain normal workspace management, but Admins
cannot assign roles, replace elevated pending invitations, or manage Owner/Admin
accounts. Payment verification/rejection, refunds, imports, checkout links, and
BOM editing remain Owner/Admin-only.

`POST /users` accepts the five invitation roles for Owners; Admins must omit
`role` and receive Staff invitations. `PATCH /invitations/:email` lets an Owner
update an unexpired invitation role without replacing its private token.
Registration uses the stored invitation role, never a role supplied by the
registrant. `PATCH /users/:id` role changes require an Owner and revoke the
affected member's sessions. Self-demotion/deactivation and removing the last
active Owner are blocked. Owners remain protected in the UI.
SQLite role constraints migrate transactionally, preserving existing users,
passwords, sessions, invitations, profile data, and foreign-key relationships.
API authorization enforces restrictions independently of navigation and buttons;
the standalone inventory service remains internal-only.

### Preferences: Inventory Alerts

Owners and Admins can open **Settings → Preferences → Inventory Alerts** to
configure low-stock and reorder thresholds per variant/SKU in its existing UOM.
Thresholds are non-negative whole numbers, evaluated separately at each location
against **available stock (on hand minus reserved)**, including order reservations.
Blank low-stock thresholds follow the catalogue minimum; blank reorder thresholds
disable replenishment alerts. Out-of-stock alerts default on at zero available
stock; their switch can be configured independently. Reset restores SKU defaults.
Inactive products/variants are not monitored.

Low-stock alerts trigger at or below their configured threshold. Out-of-stock
alerts supersede low-stock at zero; replenishment alerts are separate and trigger
at or below their reorder threshold. Stock mutations, payment reservation,
shipping, cancellation, and configuration saves synchronize persisted episodes.
Bell polling (15 seconds), focus, navigation, and local mutations refresh delivery;
generation is immediate at a platform mutation, not dependent on opening the bell.
Reading acknowledges an episode. Repeated refreshes do not duplicate it.
Recovery resolves it; a later recurrence or escalation to zero creates a new
unread notification. Alerts do not deduct stock or create purchase orders.

Recipient roles and individual active users are combined with **OR**, never
intersection. Only those recipients can list/view alerts. No selections means
no delivery; role/user changes take effect on refresh. Removed recipients lose
access to old details, but read history is preserved. Newly selected recipients
can receive currently active unread episodes. Defaults preserve prior delivery
to Owner, Admin, Staff, Inventory Controller, and Order Processing Specialist.
Customer Relations users may be explicitly selected without gaining module access.
Delivery is **in-app only**, not email or a live external integration.

`GET /inventory-alerts` reads configuration and editor choices (Owner/Admin).
`PUT /inventory-alerts` atomically replaces `rules` and `recipients`; each rule has
`variantId`, `lowEnabled`, `lowThreshold`, `outEnabled`, and `reorderThreshold`.
Recipients contain `roles` and `userIds` arrays. Invalid values, missing users,
duplicate SKUs/recipients, or unauthorized saves fail explicitly without
changing saved configuration. Inventory quantities, prices, and catalogue
minimum/medium/maximum planning levels are not changed by alert configuration.
The existing dashboard stock-planning summary continues to use catalogue
minimum/on-hand levels; the notification bell uses these available-stock rules.
Categories, overstock alerts, and automatic purchase orders are not included.

The platform and inventory data share `DATABASE_PATH` (default
`.data/sellerone.sqlite`). Set `DATABASE_PATH` to a persistent writable path for
deployment. Do not expose the standalone inventory service publicly; the
platform API is the authenticated UI-facing service.

### Inventory API

The inventory service starts with a `Main Warehouse` location. JSON request and
response bodies use integer quantities. Monetary values are integer minor units
(for example, cents); each variant declares its three-letter ISO currency code.
Valuation uses FIFO by receipt cost, and stock cannot be reduced below zero.
The standalone inventory service does not authenticate callers; keep it on a
trusted internal network and use the platform API for authenticated UI access.
Variants can have an optional description (up to 2,000 characters). The
description appears when choosing a variant for stock-in and in stock, batch,
and movement listings. Each receipt stores a description snapshot so later
catalog edits do not rewrite its historical identification. Existing SQLite
databases are migrated automatically when the inventory store starts.
In Receive stock, select a product/variant and edit the prefilled receipt
description as needed. It affects only that receipt, not the catalog. The
product selector also offers **Add new product**. Enter the product name,
first variant name, unit cost, currency, and optional catalog
variant description, then select **Save product & select**. The product is
saved to the catalog immediately and selected for the receipt; stock is added
only after **Confirm movement**. Cancelling the receipt retains the saved
catalog product.
Leave SKU blank to generate a UUID-based SKU on the server when saving, or
enter your own unique SKU. The selected product and save confirmation display
the saved SKU. Variant creation APIs also generate a SKU when `sku` is omitted;
updates preserve existing SKUs unless explicitly changed.
The stock-in API accepts optional `variantDescription` (up to 2,000 characters):
omitting it uses the catalog description; an empty string clears it for that
receipt. Receipt descriptions appear in batch and stock-in movement listings.

Each variant has one **unit of measure (UOM)**, such as `pcs`, `kg`, `liters`,
`box`, or a custom label (1-30 characters, trimmed and stored in lowercase).
New and existing variants default to `pcs`. Define UOM when adding/editing a
product or adding a new product inside Receive stock. Selecting an existing
variant prefills its UOM; it can also be defined during its first receipt.
After any stock movement, UOM is locked even if stock is later depleted.
Create a new variant to use a different UOM; existing quantities are never
converted or relabeled. Quantity, counted quantity, and reorder point remain
whole numbers in that UOM, and unit cost is the cost per UOM.
Stock balances, batches, movement history, and low-stock API listings include
`uom`; product responses also include `uomLocked`. The inventory and product
stock summaries group quantities by UOM rather than adding unlike units.
Variant creation/update and stock-in APIs accept `uom`; omitted stock-in UOM
uses the catalog value. A conflicting UOM after a movement returns HTTP 409.
Legacy SQLite databases receive the `pcs` default automatically.
Currency valuation totals remain monetary totals; the legacy `totalUnits`
field is a raw quantity sum, not a converted quantity across different UOMs.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/products?search=` | List and search products |
| `POST` | `/products` | Create a product with one or more variants |
| `GET` | `/products/:id` | Read a product and variants |
| `PATCH` | `/products/:id` | Update product name, description, or active status |
| `POST` | `/products/:id/variants` | Add a variant |
| `PATCH` | `/variants/:id` | Update UOM (before movements), SKU, barcode, attributes, cost, reorder point, or status |
| `GET` | `/products/lookup?code=` | Look up a SKU or barcode |
| `GET`, `POST` | `/locations` | List or create stock locations |
| `GET` | `/stock?locationId=&variantId=` | Read real-time stock by variant and location |
| `GET` | `/batches?variantId=&locationId=&lotNumber=&includeDepleted=` | Track lots and receipt costs |
| `POST` | `/stock/in` | Receive stock, optionally with lot, expiry, and receipt cost |
| `POST` | `/stock/out` | Issue stock; optionally target a batch or lot number |
| `POST` | `/adjustments` | Set a physical counted quantity and record the difference |
| `POST` | `/transfers` | Atomically move stock between locations |
| `GET` | `/alerts/low-stock` | List variants at or below their reorder point |
| `GET` | `/valuation?locationId=` | Get FIFO inventory valuation grouped by currency |
| `GET` | `/movements?variantId=&locationId=&limit=` | Read the movement and audit history |

Create a product:

```json
{
  "name": "Coffee Beans",
  "description": "Roasted coffee",
  "variants": [
    {
      "name": "250 g",
      "description": "Resealable pouch, dark roast",
      "sku": "COFFEE-250",
      "uom": "pcs",
      "barcode": "1000000000250",
      "attributes": { "size": "250 g", "colour": "Dark roast" },
      "unitCostMinor": 850,
      "currency": "PHP",
      "reorderPoint": 10
    }
  ]
}
```

Receive stock:

```json
{
  "variantId": "<variant-id>",
  "quantity": 25,
  "lotNumber": "LOT-2026-01",
  "expiresAt": "2027-01-31",
  "unitCostMinor": 850,
  "reference": "PO-1001"
}
```

Run inventory and platform commerce integration tests with `npm test`.

### Social commerce order processing

Open **Orders** for a unified inbox with channel, workflow-stage, payment, and
customer/order search filters, applied server-side across all orders with
50-row pagination (no hidden newest-order cutoff). Capture multiple catalog variants with their
selling prices (not inventory costs), currency, customer, fulfillment location,
external channel order ID, and delivery information. New customers are added to
the customer book. Each order has a printable, non-tax-certified invoice,
private tracking link, payment references, shipment information, communication
log, and an ordered audit timeline.

#### Order lifecycle and inventory accuracy

1. **Received**: awaiting payment; no stock is reserved yet.
2. Submit a full-amount payment reference. The seller must independently check
   the funds. A reference alone never marks an order paid.
   Leave the reference blank to generate a unique `PAY-<uppercase UUID>`
   SellerOne submission reference, or enter a real transaction ID/cash receipt
   number to preserve it. The server generates references for omitted, empty,
   or whitespace-only strings in both seller and customer submissions.
   Generated references are internal identifiers, not provider transaction IDs,
   proof of payment, or official cash receipts. They appear in the seller's
   payment records; public tracking continues to hide payment references.
3. An **owner/admin** verifies payment and reserves stock in one SQLite
   transaction. Insufficient stock rolls back both verification and all line
   reservations. Staff cannot approve, reject, or record refunds.
4. **Packing**: reserved stock remains physically on hand.
5. **Shipped**: select J&T Express, JRS Express, LBC Express, Ninja Van,
   Flash Express, SPX Express, GoGo Xpress, GrabExpress, Lalamove, or a custom
   carrier. Enter a courier-issued tracking number to preserve it, or leave it
   blank to generate a unique `SO-TRACK-<uppercase UUID>` on **Dispatch shipment**.
   Omitted, empty, and whitespace-only tracking numbers generate an internal
   SellerOne identifier, not a courier-issued number; it cannot track a parcel
   on the courier's website. Seller and customer tracking show the saved number.
   Phone and delivery address are required. All reserved items are deducted
   using FIFO in the same transaction as the stage change and saved shipment.
   Retry preserves the number and does not double-deduct stock.
6. **Delivered**: seller records delivery confirmation manually.
7. **Completed**: creates one linked sales entry; retries do not duplicate it.
   The Sales table includes a **View order / invoice** link for these entries.
   Manually recorded sales are labelled **Manual sale** and have no order link.
   After successful completion, **Mark Completed** stays disabled and
   **Print invoice** becomes available. Printing is disabled at every earlier
   stage and for cancelled orders; the state persists after reloading.

**Print invoice** opens the browser's print preview with an invoice-only A4
layout and 14 mm margins. It includes the issue date, customer details, items,
UOM, prices, total, and order/payment status. Navigation, workflow controls,
update notices, internal notes, and private tracking links are excluded.
Long invoices flow across pages with repeated item-table headers. Browser
headers/footers (URL and page title) can be disabled in the print dialog.

Reports group completed-order and manual sales by the workspace timezone.
Sales and expenses cover today and the preceding 89 calendar days, excluding
older dates and future dates. Gross sales, expenses, and net income use this
same period and the workspace reporting currency; days without sales have no
row. Orders by status remains an explicitly labelled all-time summary.
The reports API includes `timezone`, `startDay`, and `endDay` for this period.

Settings uses separate Business details and Preferences tabs. The selected
tab is reflected in the URL hash (`#business` or `#preferences`), including
reloads and browser history. Arrow keys and Home/End switch tabs. Unsaved
edits remain when switching tabs; Save settings saves only the selected
section and returns to the dashboard after saving and refreshing workspace
preferences successfully. Failed saves stay on Settings with an explicit
error and retain entered values. Team & access opens user management.

The top-right profile avatar opens a Profile Settings menu with Account details,
Security / password, Preferences, and Sign out. The sidebar account menu links
to the same personal screens. All signed-in users can manage their own name and
email at `/profile` and change their password at `/profile#security`. Role and
other users cannot be edited through the personal API.

Account details start in read-only mode. **Edit Account Details** enables the
name and email fields; **Save Changes** validates required fields and email
format, saves the updates, and returns to read-only mode with confirmation.
**Cancel** discards unsaved account changes. Failed saves keep edit mode and
entered values with an error message. Social Media Links retain their separate
save controls.

Account Details includes a **Profile Picture** section. Select an image to
preview it, then **Save profile picture** to apply it. Change, cancel a pending
selection, or remove the saved picture independently of name/email changes.
Saved pictures appear in the header, sidebar, Account Details, and authenticated
team list. Removal restores initials. Same-account tabs receive picture updates
through BroadcastChannel; reload a tab if that browser feature is unavailable.

`PUT /me/profile-picture` accepts `{ image: "data:image/...;base64,..." }` for
PNG, JPEG, or WebP; `DELETE /me/profile-picture` removes only the current user's
picture. Uploads are limited to 5 MB, single-frame images, and 4096 x 4096 pixels.
The server decodes and re-encodes a metadata-free, square 256 x 256 WebP avatar.
Images are persisted in SQLite with the account (not in Git); versioned avatar
URLs change on replacement. `GET /profile-pictures/:userId` requires a signed-in
workspace user and serves active users' pictures with private/no-store headers.
Pictures are not exposed in public checkout or tracking.

`PATCH /me` accepts `name` and `email`; email changes require `currentPassword`.
`POST /me/password` requires `currentPassword` and `newPassword` (10-200
characters, different from the current password). Email/password changes
invalidate other sessions and pending password reset links while preserving
the current session. Passwords use the existing salted scrypt implementation.
Profile preferences link owners/admins to existing workspace preferences;
staff see an explanation instead of restricted controls. No new personal
preference defaults or unsupported security integrations are introduced.

Account Details also includes Social Media Links for Facebook, Instagram,
TikTok, WhatsApp, and Website, with labelled platform-specific icons and
individual **Show in my profile menu** controls. Links are private personal
shortcuts: visible links appear only in the signed-in user's account menus;
hidden links remain editable and saved. They are not included in team lists,
auth status, customer profiles, checkout, or public tracking.

`GET /me/social-links` reads only the current user's links. `PATCH
/me/social-links` accepts a `links` object keyed by `facebookUrl`,
`instagramUrl`, `tiktokUrl`, `whatsappUrl`, or `websiteUrl`, each containing
`url` (HTTPS URL or null) and `visible` (boolean). Platform links validate
matching hosts; websites allow any HTTPS host. Credentials and non-HTTPS URLs
are rejected. Updates validate all supplied entries before saving atomically;
omitted platforms remain unchanged. Clear link removes its URL and hides it.
Blank visible links are rejected. Links open with noopener/noreferrer.
TikTok and WhatsApp use labelled music/chat glyphs from the existing icon set.

Customer profiles include an editable Social media links card beside Contact
on wide screens and stacked on small screens. Facebook, Instagram, TikTok,
WhatsApp, and Website links are optional, customer-specific, and persist after
restart. Links open in a separate tab without sharing the referring page.
Only full HTTPS URLs without embedded credentials are accepted; social links
must use their platform's domain (including subdomains). Website accepts any
HTTPS domain. Blank strings or `null` remove a link; omitted fields are unchanged.
Customer create/update APIs accept `facebookUrl`, `instagramUrl`, `tiktokUrl`,
`whatsappUrl`, and `websiteUrl`; reads expose the same fields. These are manually
maintained links, not connected or verified social accounts, and are not exposed
on public checkout or order-tracking pages.

Each Expenses table entry has a **View details** action that opens its full
description, category, recorded date, amount/currency, notes, and entry ID in a
read-only dialog. Opening details does not change or create a transaction.

### Optional Raw Material BOM

Owners and admins can enable **Raw Material BOM view** in Settings > Preferences.
The separate navigation page classifies existing inventory variants as raw
materials without filtering, hiding, duplicating, or modifying the standard
Product catalogue. New workspaces default to disabled; disabling hides the page
and blocks its API while retaining saved classifications and BOMs.

Each active non-material finished-product variant can have one editable,
single-level BOM: a positive output quantity in its existing UOM, notes, and
1-100 distinct active raw-material components with positive decimal quantities
in their own existing UOMs. Quantities are capped at 1,000,000,000. No nested BOMs,
unit conversion, production, costing, stock deduction, or changes to order
fulfillment are enabled. Existing recipe attributes are not imported or changed.
Stock receipts remain whole-number quantities under existing inventory rules.

Only Owners classify materials and save or delete structures; other authorised roles can view.
Referenced materials cannot be unclassified until removed from their BOMs, and
a BOM output cannot become a material until its BOM is deleted. Saves validate
all components before atomically replacing the structure. Saved UOM snapshots
are retained and discrepancies after catalog edits are explicitly shown for
review rather than silently converting quantities.

| Method | API | Purpose |
| --- | --- | --- |
| GET | `/raw-material-bom` | List dedicated classifications, variants, and BOMs |
| PATCH | `/raw-material-bom/materials/:variantId` | Set `isRawMaterial` boolean |
| PUT | `/raw-material-bom/:variantId` | Replace BOM with `outputQuantity`, `outputUom`, `notes`, and `components` (`variantId`, `quantity`, `uom`) |
| DELETE | `/raw-material-bom/:variantId` | Delete only the BOM structure |

### Stock planning levels

The top-bar bell opens Notification management with a selectable stock
notification list and a **per-user unread counter**. Viewing an item displays
product, SKU, location, on-hand quantity, minimum, UOM, creation date, and read
date; it persistently marks only that user's item read and immediately updates
the badge. Opening the bell alone does not mark anything read. Only pending
unread alerts are listed: viewed or acknowledged items disappear from the list
without deleting their per-user read history. The viewed details stay visible
until dismissed; Refresh alerts or reopening the panel clears those details
and reloads the pending list and count. Refresh never marks unread items read.
The empty state distinguishes no unread alerts from resolved stock shortages.

Stock notifications are persisted as shortage episodes per variant/location.
Changing stock or minimum while still low does not reset read status. After
stock recovers above minimum, a later shortage creates a new unread episode.
Inventory mutations and shipment transitions synchronize these episodes; lists
also synchronize on retrieval. Inactive variants are excluded. Reading never
changes stock, resolves shortages, verifies payments, or creates financial entries.

`GET /notifications` returns only active unread items and the signed-in user's
`unreadCount`, equal to the returned pending list length.
`POST /notifications/:id/view` returns the viewed details plus the updated list
and count. Repeated views are idempotent; inactive/resolved IDs return an error.
Read state persists across reloads and sign-ins. Other tabs on the same browser
refresh through BroadcastChannel when an item is viewed; other clients refresh
on opening, route changes, window focus, and every 15 seconds. Local successful
data mutations also refresh the bell. Loading, empty, and error states are
explicit. Close with the close button, Escape, outside click, or tabbing out.

Each variant uses its existing UOM for editable minimum, medium, and maximum
stock levels in the product editor. The minimum is the existing `reorderPoint`:
low-stock alerts still flag on-hand stock at or below that quantity. Optional
`mediumStockLevel` and `maximumStockLevel` are nullable planning targets, not
automatic replenishment triggers or hard receipt limits. Existing variants keep
their reorder points and migrate with the optional targets unset.

Levels must be non-negative whole numbers satisfying minimum <= medium <= maximum
for the targets that are set. Create and patch APIs validate the combined saved
levels; omitted patch fields are preserved and null clears an optional target.
Inventory displays all three levels alongside each variant's UOM. No unit
conversion or ingredient-to-drink production is performed.

Test stock receipts are explicit inventory movements and affect stock balances
and valuation. They do not create expenses or verify pending order payments.

### Saved selling prices

Set **Selling prices per UOM** in the product editor for each variant, including
every drink size. Inline product creation during stock receiving also accepts
an optional selling price. Prices use the variant's currency and UOM, separately
from inventory unit cost. Existing variants start without a selling price; no
prices are inferred from costs or recipes. Blank removes a saved price; zero is
an explicit free price. API create/patch uses optional `sellingPriceMinor`
(non-negative integer minor units, or `null` to clear).

Selecting a product in a manual order or checkout-offer form fills its saved
selling price. Selecting a different product resets the field to that product's
price (blank when unset). Sellers may override prices for that order/offer
without changing the catalog. Orders, imports and checkout offers may omit
`unitPriceMinor` to use the current catalog price; if none is saved, explicit
pricing is required. Captured orders and offers retain their price snapshots
after catalog changes. Public checkout continues to use the offer's price,
never client-supplied prices or catalog costs. No ingredient deduction or unit
conversion is added.

Received orders show item-level required, available, and reserved quantities
at their fulfillment location, with repeated items combined. Shortages provide
a Receive stock link that preselects the variant, location, and shortage
quantity. Receiving still requires an explicit confirmed movement. Return to
the order to retry verification; neither the link nor the stock availability
refresh automatically verifies payment. Insufficient stock continues to roll
back verification and reservations. Finished drink stock is separate from
ingredient inventory; no recipe reservation, deduction, or unit conversion is
implied by this workflow.

Inventory shows on-hand, reserved, and available quantities per UOM/location.
Manual stock-outs, transfers, and physical-count adjustments cannot consume
reserved stock. There is no unit conversion. Pre-dispatch cancellation releases
reservations; verified payments then show **Refund due**. Refund money outside
SellerOne first, then record the refund reference. Dispatched orders cannot be
cancelled through this workflow; returns/exchanges and partial refunds are not
implemented. This release uses full-payment-before-dispatch; COD, installments,
discounts, tax computation, and shipping-fee calculation are not implemented.
Orders with different currencies cannot mix items.

The platform shares one SQLite connection with inventory so order, payment,
reservation, stock movement, and linked sale changes commit or roll back
together. Existing orders migrate automatically: pending/processing become
received (they have no verified reservation), while shipped/delivered/cancelled
retain their stage. Historical shipped orders are not retrospectively deducted.
Legacy items are matched by SKU at verification; unmatched items must be
cancelled and recreated. New orders snapshot UOM and reject verification if the
catalog UOM changed before stock was received. Dashboard, customer order history,
and reports reflect the new stages. Customer lifetime order spending includes
delivered/completed orders rather than unconfirmed submissions.

#### Checkout app links and customer tracking

Owners/admins choose **Create app link**, set selling prices, channel, location,
and a validity of 1-90 days. Copy the generated `/checkout/<random-token>` URL
into a social post, bio, chat, or message. Each link is a reusable offer/cart;
customers choose quantities, enter contact/delivery details, and submit without
an account. Checkout prices are enforced on the server. Invalid, inactive,
expired, unoffered, and insufficient-stock selections are rejected. A checkout
does not guarantee inventory until payment is verified.

The confirmation redirects to `/track/<random-token>`. Customers can refresh
status, see shipment details and seller messages, and submit a payment reference.
Tracking does not disclose customer contact/address, internal notes, payment
references, reviewers, or staff identities. Tracking URLs are private bearer
capabilities: send only to the intended customer, never publish them. Disabling
a checkout link blocks new submissions but does not break existing tracking.
Public API responses are non-cacheable, pages do not send referrer URLs, and
public requests have basic per-network-address limits (120 reads / 20 writes
per minute per process). Configure proper HTTPS hosting and edge rate limiting
before exposing this application publicly; localhost links work only locally.

There is no live TikTok/Meta capture, online payment collection, automated
bank verification, automatic email/social messaging, or carrier callback.
Use **Customer communication** to prepare a message, send it manually through
your channel, and log it as sent; only sent messages appear on customer tracking.
Never mark a draft sent unless it was actually delivered through your channel.

#### Authenticated import and commerce APIs

All private endpoints require the existing SellerOne session cookie; owner/admin
permissions additionally apply to imports, checkout-link management, and payment
review/refund. Browser writes must be same-origin. Routes below have `/api`
prefixes. New order creation accepts optional `idempotencyKey`; import uses
unique `(channel, externalId)` and returns the original order on duplicate
delivery. Public checkout requires `idempotencyKey`; reuse it to safely retry
the same submission. Do not reuse a key for a different purchase.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/orders` | Unified inbox / create a received order |
| `POST` | `/orders/import` | Import one normalized channel order with externalId |
| `GET` | `/orders/:id` | Invoice, items, payments, shipping, timeline, communication |
| `PATCH` | `/orders/:id` | Advance `{stage}` through allowed transitions |
| `POST` | `/orders/:id/payments` | Submit method, reference, amountMinor, currency |
| `POST` | `/orders/:id/verify-payment` | Verify `{paymentId, note?}` and reserve inventory |
| `POST` | `/orders/:id/reject-payment` | Reject `{paymentId, note}` |
| `POST` | `/orders/:id/shipping` | Set `{customerPhone, shippingAddress}` before dispatch |
| `POST` | `/orders/:id/refund` | Record `{note}` for manual refund on cancelled order |
| `POST` | `/orders/:id/communications` | Log `{message, status: "prepared" \| "sent"}` |
| `GET` | `/commerce/channels` | Channel names and honest connection status |
| `GET`, `POST` | `/checkout-links` | List / create reusable checkout app links |
| `DELETE` | `/checkout-links/:id` | Disable future checkout submissions |
| `GET`, `POST` | `/public/checkout/:token` | Read offer / submit customer checkout |
| `GET` | `/public/tracking/:token` | Privacy-restricted order tracking |
| `POST` | `/public/tracking/:token/payments` | Submit a reference, never verify a payment |

Example normalized import:

```json
{
  "channel": "TikTok Shop",
  "externalId": "CHANNEL-ORDER-123",
  "customerName": "Customer Name",
  "customerEmail": "customer@example.com",
  "customerPhone": "09123456789",
  "shippingAddress": "Delivery address",
  "locationId": "main",
  "currency": "PHP",
  "items": [
    { "sku": "COFFEE-250", "quantity": 2, "unitPriceMinor": 15000 }
  ]
}
```

Use `variantId` instead of `sku` when known. An adapter with approved provider
API access must translate native payloads to this format before importing.
Raw provider webhooks are not accepted and no connectors are simulated.
Dispatch requires `{ "stage": "shipped", "carrier": "..." }`, with optional
`trackingNumber`. Nonblank strings are trimmed and preserved (maximum 150
characters); omitted or blank strings generate an internal tracking number.
Carrier names remain free-form in the API (maximum 100 characters).
Legacy free-form `{status}` updates are intentionally rejected to prevent
bypassing payment and inventory guards.
The inbox GET supports `page`, `search`, `stage`, `channel`, and `payment` query
parameters and returns `{items, total, page, pageSize}`.

### Run with Docker Compose

```sh
docker compose up --build
```

The web app and platform API are served together on port `3100`, with SQLite
persisted in the `sellerone-data` volume. Configure SMTP variables in the
environment for password reset email delivery. Put the service behind an HTTPS
reverse proxy before production use.

### Repository layout

```text
apps/
  web/
services/
  accounting/
  customers/
  inventory/
  orders/
  platform/
docker-compose.yml
Dockerfile
```
