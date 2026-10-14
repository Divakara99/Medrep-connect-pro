import assert from 'node:assert/strict'
import { extractVacancyFields, vacancyDraftFingerprint } from '../src/data/vacancyExtraction.ts'

const flyerText = `
URGENTLY REQUIRED
MEDICAL REPRESENTATIVE (MR)
BENGALURU HEADQUARTERS
Meyer Organics Pvt Ltd.
PHARMA DIVISION
Vacancy Area
Vijayanagar / Kolar
No. of Vacancies
1 Position
Experience
Minimum 6 Months
Age Limit
Below 25 Years
Qualification
Any Degree
Annual Package
Up to ₹3.5 Lakhs
Interested Candidates
Contact: AFM – Dharaneesh B
9052053050
Call or WhatsApp your resume today!
`
const flyer = extractVacancyFields(flyerText)
assert.equal(flyer.title, 'Medical Representative (MR)')
assert.equal(flyer.company, 'Meyer Organics Pvt Ltd')
assert.equal(flyer.category, 'MR')
assert.equal(flyer.hq, 'BENGALURU')
assert.equal(flyer.division, 'PHARMA')
assert.equal(flyer.location, 'Vijayanagar / Kolar')
assert.equal(flyer.experience, 'Minimum 6 Months')
assert.equal(flyer.ageLimit, 'Below 25 Years')
assert.equal(flyer.qualification, 'Any Degree')
assert.equal(flyer.vacancyCount, '1 Position')
assert.equal(flyer.salary, 'Up to ₹3.5 Lakhs')
assert.equal(flyer.manager, 'Dharaneesh B')
assert.equal(flyer.contact, '9052053050')
assert.equal(flyer.description, undefined, 'unlabeled poster text must not be copied into the public description')
assert.doesNotMatch(flyer.description ?? '', /9052053050|Dharaneesh|whatsapp|resume today/i, 'contact details stay out of the public description')

const pastedText = `
VACANCY FOR MR
COMPANY: SUN PHARMA
DIVISION : PHARMA CARE
AREA : BANASHANKARI
DESIGNATION : MR
AGE : BELOW 26
QUALIFICATION : BSC/ B Pharma.
CONTACT : VIJAY KANTH
MOB : 9066411078
KARTHIK KUMAR (RBM)
MOB : +91 90352 80940
`
const pasted = extractVacancyFields(pastedText)
assert.equal(pasted.title, 'Medical Representative (MR)')
assert.equal(pasted.company, 'SUN PHARMA')
assert.equal(pasted.division, 'PHARMA CARE')
assert.equal(pasted.location, 'BANASHANKARI')
assert.equal(pasted.ageLimit, 'BELOW 26')
assert.equal(pasted.qualification, 'BSC/ B Pharma.')
assert.equal(pasted.manager, 'VIJAY KANTH')
assert.equal(pasted.contact, '9066411078')
assert.equal(pasted.managerAltPhone, '9035280940')
assert.equal(pasted.description, undefined, 'pasted vacancy fields without a description heading leave description blank')
assert.doesNotMatch(pasted.description ?? '', /9066411078|9035280940|KARTHIK/i, 'contact block does not leak into the public description')

const contactBlockText = `
VACANCY FOR MR
COMPANY: MEYER ORGANICS
CONTACT DETAILS
AFM – Dharaneesh B
MOB: 9052053050
`
assert.equal(extractVacancyFields(contactBlockText).manager, 'Dharaneesh B', 'a role-prefixed contact name is extracted from the contact block')

const asmManager = extractVacancyFields(['DESIGNATION: MR', 'ASM: Karthik Kumar', 'MOB: 9066411078'].join(String.fromCharCode(10)))
assert.equal(asmManager.manager, 'Karthik Kumar', 'ASM role labels beside a phone fill only the manager field')
const abmManager = extractVacancyFields(['DESIGNATION: MR', 'Vijay Kanth (ABM)', 'PHONE: 9035280940'].join(String.fromCharCode(10)))
assert.equal(abmManager.manager, 'Vijay Kanth', 'ABM role tags beside a phone fill only the manager field')
assert.equal(asmManager.description, undefined)
assert.equal(abmManager.description, undefined)
const roleOnlyManager = extractVacancyFields(['DESIGNATION: Sales Executive', 'ABM: Karthik Kumar', 'MOB: 9066411078'].join(String.fromCharCode(10)))
assert.equal(roleOnlyManager.manager, 'Karthik Kumar')
assert.equal(roleOnlyManager.category, undefined, 'an ABM manager tag must not set the vacancy category')
const alternateOnly = extractVacancyFields(['DESIGNATION: MR', 'ALTERNATE NUMBER: +91 90352 80940'].join(String.fromCharCode(10)))
assert.equal(alternateOnly.managerAltPhone, '9035280940', 'an explicitly labelled alternate number is kept as the alternate')
assert.equal(alternateOnly.contact, undefined, 'an alternate-only source does not mislabel it as the primary contact')

const explicitDescriptionText = `
DESIGNATION: MR
COMPANY: SUN PHARMA
AREA: BENGALURU
JOB DESCRIPTION:
Call on doctors and chemists in the assigned territory.
Plan daily field visits and submit weekly reports.
CONTACT DETAILS:
Mr. Asha Nair
MOB: 9066411078
`
const withDescription = extractVacancyFields(explicitDescriptionText)
assert.equal(withDescription.manager, 'Asha Nair', 'a name after a contact-details heading fills Manager')
assert.equal(withDescription.description, ['Call on doctors and chemists in the assigned territory.', 'Plan daily field visits and submit weekly reports.'].join(String.fromCharCode(10)))
assert.doesNotMatch(withDescription.description ?? '', /9066411078|Asha Nair/i, 'explicit public description excludes the contact block')

assert.equal(
  vacancyDraftFingerprint({ title: 'MR  Role', company: 'Sun Pharma' }),
  vacancyDraftFingerprint({ title: ' mr role ', company: ' SUN PHARMA ' }),
  'review fingerprints ignore case and repeated whitespace',
)

console.log('vacancy extraction: reference-style posters, contact privacy, new fields and review fingerprints passed')
