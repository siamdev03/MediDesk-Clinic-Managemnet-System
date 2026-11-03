# MediDesk – Feature list (110)

## Platform & security (1–14)
1. JWT sign-in with 7-day sessions
2. First-run wizard that creates the administrator account
3. Seven roles: admin, doctor, nurse, receptionist, pharmacist, lab technician, accountant
4. Role-based access on every module (read / write / delete rules enforced by the API)
5. Menu and buttons adapt to the signed-in role
6. Account lock for 15 minutes after 5 wrong passwords (admin can unlock)
7. Login rate limiting
8. Password hashing (bcrypt)
9. Admin: create / edit / deactivate users, reset a user's password
10. My-profile page and change-password
11. Audit log of every create / update / delete / action / login (admin only)
12. Soft delete with Trash view and admin restore
13. Dark mode
14. Responsive layout (phone, tablet, desktop)

## Productivity tools that work on every module (15–28)
15. Search box with debounced live search
16. Filters by status, doctor, ward, category and more
17. Date-range filter
18. Click-to-sort columns
19. Pagination
20. Create / edit forms generated from the field definitions, with validation
21. Detail view of any record with all fields and line items
22. Export current list to CSV
23. Import rows from CSV (up to 500 at a time, with per-row error report)
24. Bulk delete
25. Print view for any record
26. Searchable dropdowns for linked records (patient, doctor, medicine, …)
27. Auto-fill (selecting a service fills price, a doctor fills fee, a medicine fills name, …)
28. Auto-numbered codes for every record (PT-000001, APT-000001, INV-000001, …)

## Dashboard & global tools (29–40)
29. Role-aware dashboard with 16 live stat tiles
30. Revenue / expenses / dues cards (finance roles)
31. Appointments – last 14 days chart
32. Collections – last 14 days chart
33. Appointments-by-status chart
34. Top doctors this month
35. Today's schedule widget
36. Recently registered patients
37. Announcements banner
38. Global search across patients, doctors, appointments, invoices, medicines and more (press `/`)
39. Notification bell: low stock, expiring / expired medicines, overdue invoices, pending lab, equipment maintenance, blood expiry, due tasks
40. Auto-refreshing dashboard

## Front desk (41–52)
41. Appointment booking with doctor schedule validation (working days, shift hours)
42. Visual free-slot picker per doctor and date
43. Double-booking prevention
44. Automatic token number per doctor per day
45. Appointment workflow: confirm → check-in → start → complete
46. Cancel (with reason), no-show and reschedule actions
47. One-click invoice from an appointment
48. Month calendar view of appointments, filter by doctor
49. Live OPD queue board with priority patients and call / start / done / skip
50. Walk-in patients in the queue without registration
51. Teleconsultations with auto-generated meeting link
52. Visitor log with check-out

## Clinical (53–68)
53. Patient registration with duplicate detection (name + phone)
54. Rich patient record: demographics, emergency contact, allergies, chronic conditions, insurance
55. Allergy and condition warnings on the patient header
56. Patient 360° profile with tabs and activity timeline
57. Quick-add buttons from the profile (appointment, vitals, prescription, lab, invoice, admission, vaccine, document)
58. Outstanding-dues alert on the profile
59. Consultation notes (complaint, history, examination, diagnosis, plan, advice, follow-up)
60. ICD-10 code library linked to diagnoses
61. Vitals with automatic BMI
62. Vitals trend charts (BP, weight)
63. Prescriptions with multiple medicines, dosage, frequency, duration and instructions
64. Printable prescription with doctor signature block
65. Immunization records
66. Patient documents and file upload (PDF, images, Office files)
67. Medical certificates
68. Completing a consultation automatically completes its appointment

## Diagnostics (69–76)
69. Lab test catalog with price, unit, normal range and turnaround
70. Lab orders with several tests
71. Lab workflow: sample collected → processing → complete & release
72. Automatic High / Low / Normal flag from the normal range
73. Printable lab report
74. One-click invoice from a lab order
75. Radiology / imaging orders and reports
76. Health check-up packages

## Pharmacy (77–88)
77. Medicine master with batch, expiry, rack, barcode, reorder level
78. Low-stock and near-expiry detection
79. Expired-stock detection and write-off action
80. Manual stock adjustment with reason
81. Stock ledger of every movement
82. Pharmacy point-of-sale (counter sales)
83. Due sales and "collect due" action
84. Refund / return to stock
85. Dispense a prescription as a pharmacy sale in one click
86. Suppliers
87. Purchase orders: draft → ordered → received (adds stock automatically)
88. Record purchase-order payment as an expense

## Inpatient & facility (89–100)
89. Wards and beds
90. Live bed map by status
91. Admissions (IPD) with bed availability check
92. Discharge with summary; bed goes to "cleaning"
93. Transfer between beds with transfer log
94. Bed-charge invoice from an admission
95. Surgeries / OT scheduling with room and surgeon clash detection
96. Ambulances and trips (dispatch, complete, bill)
97. Blood bank inventory with reserve / issue / discard and expiry marking
98. Blood donors and donation records
99. Birth and death records
100. Equipment register with maintenance log; general inventory with quantity adjust

## Billing & insurance (101–106)
101. Invoices with line items, discount and tax; totals calculated by the server
102. Partial payments with automatic Unpaid / Partial / Paid status
103. Payments ledger with method and reference; refund action
104. Printable invoice and receipt history
105. Expense tracking by category
106. Insurance providers, patient policies and claims (submit → approve / reject → settled)

## People, communication & reporting (107–110)
107. Doctors (schedule, fee, department), departments, staff, attendance (mark everyone present), leave approval, duty roster, payroll generation and mark-paid
108. Announcements, patient feedback with resolution, internal tasks
109. Ten reports with charts and CSV per table: revenue / expense / profit, appointments, doctor performance, patients & demographics, pharmacy sales, stock & expiry, laboratory, dues aging, inpatient occupancy, attendance & payroll
110. Admin settings (clinic details, currency, tax, alert thresholds), full JSON backup download, one-command demo-data seeding
