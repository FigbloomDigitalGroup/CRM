/**
 * Sample data for the dev seed (FIG-1016, B0.08), taken from the approved
 * design prototype's `design-spec/crm-store.js`, so the demo database, the
 * tests and the screens show the same people and records. Fictional
 * scaffolding: companies are well-known Kenyan businesses used as plausible
 * prospects; every person is made up. Dates are the prototype's (around
 * 19 Oct 2026); the seed shifts them to be relative to the day it runs.
 *
 * Payments, tags, templates and the quote catalogue in the prototype have no
 * model yet; they join the seed with the issues that create them (B3.03 and
 * later). Not generated at runtime: edit this file directly.
 */

export type DevUserId = "mg" | "s1" | "s2" | "dl" | "fn" | "tc";

export interface SampleCompany {
  id: string; name: string; industry?: string | null; lifecycle: string; ownerId?: DevUserId | null;
  phone?: string | null; email?: string | null; website?: string | null; location?: string | null; createdAt: string;
  services: { name: string; status: string; label?: string }[];
}
export interface SampleContact {
  id: string; first: string; last?: string | null; title?: string | null; department?: string | null;
  companyId?: string | null; email?: string | null; phone?: string | null; ownerId?: DevUserId | null;
}
export interface SampleLead {
  id: string; companyId?: string | null; contactId?: string | null; name: string; status: string;
  temp: string; source: string; service?: string | null; ownerId?: DevUserId | null; next?: string | null;
  createdAt: string; qual?: Record<string, string> | null; notes?: string | null; lostReason?: string | null;
  archived?: boolean; dealId?: string | null;
}
export interface SampleDeal {
  id: string; companyId: string; contactId?: string | null; title: string; service?: string | null; stage: string;
  value?: number; ownerId: DevUserId; close?: string | null; source?: string | null; createdAt: string;
  wonAt?: string | null; lostReason?: string | null;
  handoff?: { ownerId: DevUserId; scope: string; requirements: string[]; start: string };
}
export interface SampleTask {
  id: string; title: string; assigneeId: DevUserId; due?: string | null; priority: string; status: string;
  link?: { type: string; id: string } | null; desc?: string | null; doneAt?: string | null;
}
export interface SampleActivity {
  id: string; rt: string; rid: string; kind: string; byId: DevUserId | null; at: string; text: string; outcome?: string | null;
}
export interface SampleRecurring {
  id: string; companyId: string; service: string; cycle: string; value: number; renews: string; ownerId: DevUserId;
}
export interface SampleNotification {
  id: string; type: string; to: DevUserId[]; text: string; at: string; read: boolean; link?: [string, string | null];
}
export interface SampleData {
  companies: SampleCompany[]; contacts: SampleContact[]; leads: SampleLead[]; deals: SampleDeal[];
  tasks: SampleTask[]; activities: SampleActivity[]; recurring: SampleRecurring[]; notifications: SampleNotification[];
}

/** The prototype's "now" (19 Oct 2026, 15:12 Nairobi). Dates are shifted by the distance from this to the seed run. */
export const SAMPLE_NOW = "2026-10-19T12:12:00.000Z";

export const SAMPLE_DATA: SampleData = {
  "companies": [
    {
      "id": "c1",
      "name": "Davis & Shirtliff",
      "industry": "Engineering",
      "lifecycle": "Onboarding",
      "ownerId": "s2",
      "phone": "+254 20 696 8000",
      "email": "info@davisandshirtliff.com",
      "website": "davisandshirtliff.com",
      "location": "Industrial Area, Nairobi",
      "createdAt": "2026-09-02T07:00:00.000Z",
      "services": [
        {
          "name": "HR",
          "status": "Onboarding",
          "label": "HR automation (leave, payroll export, self-service)"
        }
      ]
    },
    {
      "id": "c2",
      "name": "Sarova Hotels",
      "industry": "Hospitality",
      "lifecycle": "Prospect",
      "ownerId": "s1",
      "phone": "+254 709 111 000",
      "email": "reservations@sarovahotels.com",
      "website": "sarovahotels.com",
      "location": "Westlands, Nairobi",
      "createdAt": "2026-09-04T06:00:00.000Z",
      "services": []
    },
    {
      "id": "c3",
      "name": "Two Rivers Mall",
      "industry": "Real Estate",
      "lifecycle": "Prospect",
      "ownerId": "s2",
      "phone": "+254 709 980 000",
      "email": "info@tworiversmall.co.ke",
      "website": "tworiversmall.co.ke",
      "location": "Ruaka, Kiambu",
      "createdAt": "2026-09-09T06:00:00.000Z",
      "services": []
    },
    {
      "id": "c4",
      "name": "Brookside Dairy",
      "industry": "Manufacturing",
      "lifecycle": "Prospect",
      "ownerId": "s1",
      "phone": "+254 20 356 0000",
      "email": "info@brookside.co.ke",
      "website": "brookside.co.ke",
      "location": "Ruiru",
      "createdAt": "2026-09-12T06:00:00.000Z",
      "services": []
    },
    {
      "id": "c5",
      "name": "Artcaffe Group",
      "industry": "Hospitality",
      "lifecycle": "Prospect",
      "ownerId": "s2",
      "phone": "+254 711 000 222",
      "email": "hello@artcaffe.co.ke",
      "website": "artcaffe.co.ke",
      "location": "Westlands, Nairobi",
      "createdAt": "2026-09-15T06:00:00.000Z",
      "services": []
    },
    {
      "id": "c6",
      "name": "Twiga Foods",
      "industry": "Logistics",
      "lifecycle": "Prospect",
      "ownerId": "s1",
      "phone": "+254 709 258 000",
      "email": "info@twiga.com",
      "website": "twiga.com",
      "location": "Tatu City",
      "createdAt": "2026-10-01T06:00:00.000Z",
      "services": []
    },
    {
      "id": "c7",
      "name": "Naivas Supermarket",
      "industry": "Retail",
      "lifecycle": "Prospect",
      "ownerId": "s2",
      "phone": "+254 709 676 000",
      "email": "procurement@naivas.co.ke",
      "website": "naivas.co.ke",
      "location": "Nairobi CBD",
      "createdAt": "2026-10-03T06:00:00.000Z",
      "services": []
    },
    {
      "id": "c8",
      "name": "Java House Africa",
      "industry": "Hospitality",
      "lifecycle": "Prospect",
      "ownerId": "s1",
      "phone": "+254 719 058 000",
      "email": "marketing@javahouseafrica.com",
      "website": "javahouseafrica.com",
      "location": "Kilimani, Nairobi",
      "createdAt": "2026-10-06T06:00:00.000Z",
      "services": []
    },
    {
      "id": "c9",
      "name": "Hillcrest Preparatory School",
      "industry": "Education",
      "lifecycle": "Active Customer",
      "ownerId": "s1",
      "phone": "+254 722 203 000",
      "email": "bursar@hillcrest.ac.ke",
      "website": "hillcrest.ac.ke",
      "location": "Lang’ata, Nairobi",
      "createdAt": "2026-06-02T06:00:00.000Z",
      "services": [
        {
          "name": "Web Development",
          "status": "Live",
          "label": "School website and parent portal"
        },
        {
          "name": "Starlink / Internet",
          "status": "Renewal due 15 Nov",
          "label": "Campus Starlink kit (hosting renewal due)"
        }
      ]
    },
    {
      "id": "c10",
      "name": "Kileleshwa Property Managers",
      "industry": "Property Management",
      "lifecycle": "Dormant Customer",
      "ownerId": "s2",
      "phone": "+254 733 411 900",
      "email": "admin@kpm.co.ke",
      "website": "kpm.co.ke",
      "location": "Kileleshwa, Nairobi",
      "createdAt": "2026-02-10T06:00:00.000Z",
      "services": [
        {
          "name": "Starlink / Internet",
          "status": "Live",
          "label": "Starlink for 3 managed blocks"
        }
      ]
    }
  ],
  "contacts": [
    {
      "id": "p1",
      "first": "Mutiso",
      "last": "Kyalo",
      "title": "Engineering Lead",
      "department": "Engineering",
      "companyId": "c1",
      "email": "mutiso.kyalo@davisshirtliff.co.ke",
      "phone": "+254712345608",
      "ownerId": "s2"
    },
    {
      "id": "p2",
      "first": "Nyambura",
      "last": "Githinji",
      "title": "General Manager",
      "department": "Management",
      "companyId": "c2",
      "email": "nyambura.githinji@sarovahotels.co.ke",
      "phone": "+254712345607",
      "ownerId": "s1"
    },
    {
      "id": "p3",
      "first": "Wafula",
      "last": "Simiyu",
      "title": "Facilities Manager",
      "companyId": "c3",
      "email": "wafula.simiyu@tworiversmall.co.ke",
      "phone": "+254712345606",
      "ownerId": "s2"
    },
    {
      "id": "p4",
      "first": "Chebet",
      "last": "Kiprono",
      "title": "Supply Chain Manager",
      "companyId": "c4",
      "email": "chebet.kiprono@brooksidedairy.co.ke",
      "phone": "+254712345605",
      "ownerId": "s1"
    },
    {
      "id": "p5",
      "first": "Njoroge",
      "last": "Mwangi",
      "title": "Finance Director",
      "companyId": "c5",
      "email": "njoroge.mwangi@artcaffegroup.co.ke",
      "phone": "+254712345604",
      "ownerId": "s2"
    },
    {
      "id": "p6",
      "first": "Akinyi",
      "last": "Owino",
      "title": "IT Manager",
      "companyId": "c6",
      "email": "akinyi.owino@twigafoods.co.ke",
      "phone": "+254712345603",
      "ownerId": "s1"
    },
    {
      "id": "p7",
      "first": "Otieno",
      "last": "Odhiambo",
      "title": "Procurement Lead",
      "companyId": "c7",
      "email": "otieno.odhiambo@naivassupermarket.co.ke",
      "phone": "+254712345602",
      "ownerId": "s2"
    },
    {
      "id": "p8",
      "first": "Wanjiku",
      "last": "Kamau",
      "title": "Marketing Manager",
      "department": "Marketing",
      "companyId": "c8",
      "email": "wanjiku.kamau@javahouseafrica.com",
      "phone": "+254712345601",
      "ownerId": "s1"
    },
    {
      "id": "p9",
      "first": "Grace",
      "last": "Achieng",
      "title": "Bursar",
      "companyId": "c9",
      "email": "grace.achieng@hillcrest.ac.ke",
      "phone": "+254722556301",
      "ownerId": "s1"
    },
    {
      "id": "p10",
      "first": "Peter",
      "last": "Ndungu",
      "title": "Operations Director",
      "companyId": "c10",
      "email": "peter@kpm.co.ke",
      "phone": "+254733411902",
      "ownerId": "s2"
    },
    {
      "id": "p11",
      "first": "Amara",
      "last": "Osei",
      "title": "Founder, Osei Studio",
      "companyId": null,
      "email": "amara@oseistudio.co.ke",
      "phone": "+254700412233",
      "ownerId": null
    },
    {
      "id": "p12",
      "first": "Live Verify",
      "last": "FB Lead",
      "title": "",
      "companyId": null,
      "email": "",
      "phone": "+254700099999",
      "ownerId": "s1"
    }
  ],
  "leads": [
    {
      "id": "l1",
      "companyId": "c2",
      "contactId": "p2",
      "name": "Sarova Hotels",
      "status": "New",
      "temp": "Warm",
      "source": "Instagram",
      "service": "Starlink / Internet",
      "ownerId": "s2",
      "next": "2026-10-21T07:00:00.000Z",
      "createdAt": "2026-10-14T08:00:00.000Z",
      "qual": {
        "units": "5 properties",
        "occupied": "",
        "provider": "Safaricom Fibre"
      },
      "notes": "Asked about backup internet for the coast properties."
    },
    {
      "id": "l2",
      "companyId": "c3",
      "contactId": "p3",
      "name": "Two Rivers Mall",
      "status": "Needs Identified",
      "temp": "Hot",
      "source": "Direct Outreach",
      "service": "Property Management",
      "ownerId": "s2",
      "next": "2026-10-19T13:00:00.000Z",
      "createdAt": "2026-10-02T07:00:00.000Z",
      "qual": {
        "units": "210 retail units",
        "occupied": "188",
        "provider": "Excel + email"
      },
      "notes": "Wants tenant billing and service charge tracking."
    },
    {
      "id": "l3",
      "companyId": "c6",
      "contactId": "p6",
      "name": "Twiga Foods",
      "status": "New",
      "temp": "Warm",
      "source": "LinkedIn",
      "service": "Fleet / GPS",
      "ownerId": "s1",
      "next": "2026-10-20T08:00:00.000Z",
      "createdAt": "2026-10-16T06:30:00.000Z",
      "qual": {
        "vehicles": "64 trucks"
      },
      "notes": ""
    },
    {
      "id": "l4",
      "companyId": "c7",
      "contactId": "p7",
      "name": "Naivas Supermarket",
      "status": "Contacted",
      "temp": "Warm",
      "source": "Website",
      "service": "ISP Billing",
      "ownerId": "s2",
      "next": "2026-10-06T12:17:00.000Z",
      "createdAt": "2026-09-29T06:00:00.000Z",
      "qual": {},
      "notes": "Enquiry via website form."
    },
    {
      "id": "l5",
      "companyId": "c8",
      "contactId": "p8",
      "name": "Java House Africa",
      "status": "Qualified",
      "temp": "Hot",
      "source": "Referral",
      "service": "Social Media Management",
      "ownerId": "s1",
      "next": "2026-10-19T13:30:00.000Z",
      "createdAt": "2026-10-08T11:00:00.000Z",
      "qual": {
        "budget": "KES 90,000 / month",
        "timeline": "Start November",
        "decision": "Wanjiku Kamau"
      },
      "notes": "Referred by Artcaffe. Wants a 6-month retainer."
    },
    {
      "id": "l6",
      "companyId": null,
      "contactId": "p11",
      "name": "Amara Osei",
      "status": "New",
      "temp": "Hot",
      "source": "Website",
      "service": "Web Development",
      "ownerId": null,
      "next": "2026-10-19T14:00:00.000Z",
      "createdAt": "2026-10-19T06:40:00.000Z",
      "qual": {},
      "notes": "Portfolio site with booking for a design studio."
    },
    {
      "id": "l7",
      "companyId": null,
      "contactId": "p12",
      "name": "Live Verify FB Lead",
      "status": "New",
      "temp": "Cold",
      "source": "Facebook",
      "service": "Branding",
      "ownerId": "s1",
      "next": null,
      "createdAt": "2026-10-19T05:05:00.000Z",
      "qual": {},
      "notes": "Test lead from Facebook Lead Ads."
    },
    {
      "id": "l8",
      "companyId": null,
      "contactId": null,
      "name": "Greenpark Estates",
      "status": "Lost",
      "temp": "Cold",
      "source": "Phone",
      "service": "Property Management",
      "ownerId": "s2",
      "next": null,
      "createdAt": "2026-09-05T06:00:00.000Z",
      "qual": {},
      "lostReason": "No Budget",
      "archived": true
    },
    {
      "id": "l9",
      "companyId": null,
      "contactId": null,
      "name": "Riverside Clinic",
      "status": "Unqualified",
      "temp": "Cold",
      "source": "TikTok",
      "service": "Consulting / Other",
      "ownerId": "s1",
      "next": null,
      "createdAt": "2026-09-12T06:00:00.000Z",
      "qual": {},
      "archived": true
    },
    {
      "id": "l10",
      "companyId": "c1",
      "contactId": "p1",
      "name": "Davis & Shirtliff",
      "status": "Converted",
      "temp": "Hot",
      "source": "Networking",
      "service": "HR",
      "ownerId": "s2",
      "next": null,
      "createdAt": "2026-09-02T06:00:00.000Z",
      "qual": {},
      "notes": "Converted to deal in August.",
      "dealId": "d4"
    },
    {
      "id": "l11",
      "companyId": "c9",
      "contactId": "p9",
      "name": "Hillcrest Preparatory School",
      "status": "Converted",
      "temp": "Warm",
      "source": "Referral",
      "service": "Web Development",
      "ownerId": "s1",
      "next": null,
      "createdAt": "2026-07-10T06:00:00.000Z",
      "qual": {},
      "notes": "",
      "dealId": "d6"
    },
    {
      "id": "l12",
      "companyId": "c10",
      "contactId": "p10",
      "name": "Kileleshwa Property Managers",
      "status": "Converted",
      "temp": "Warm",
      "source": "Phone",
      "service": "Starlink / Internet",
      "ownerId": "s2",
      "next": null,
      "createdAt": "2026-01-20T06:00:00.000Z",
      "qual": {},
      "notes": "",
      "dealId": "d7"
    }
  ],
  "deals": [
    {
      "id": "d1",
      "companyId": "c4",
      "contactId": "p4",
      "title": "Inventory system for 3 depots",
      "service": "Inventory",
      "stage": "Solution Presented",
      "value": 450000,
      "ownerId": "s1",
      "close": "2026-12-01T06:00:00.000Z",
      "source": "Referral",
      "createdAt": "2026-09-20T06:00:00.000Z"
    },
    {
      "id": "d2",
      "companyId": "c5",
      "contactId": "p5",
      "title": "Website rebuild and online ordering",
      "service": "Web Development",
      "stage": "Proposal Sent",
      "value": 320000,
      "ownerId": "s2",
      "close": "2026-11-15T06:00:00.000Z",
      "source": "Instagram",
      "createdAt": "2026-09-25T06:00:00.000Z"
    },
    {
      "id": "d3",
      "companyId": "c2",
      "contactId": "p2",
      "title": "CCTV across 5 properties",
      "service": "CCTV",
      "stage": "Negotiation",
      "value": 980000,
      "ownerId": "s1",
      "close": "2026-11-20T06:00:00.000Z",
      "source": "Physical Meeting",
      "createdAt": "2026-09-01T06:00:00.000Z"
    },
    {
      "id": "d4",
      "companyId": "c1",
      "contactId": "p1",
      "title": "HR automation rollout",
      "service": "HR",
      "stage": "Closed Won",
      "value": 1250000,
      "ownerId": "s2",
      "close": "2026-10-30T06:00:00.000Z",
      "source": "Networking",
      "createdAt": "2026-09-02T06:00:00.000Z",
      "wonAt": "2026-10-15T11:00:00.000Z",
      "handoff": {
        "ownerId": "dl",
        "scope": "Leave management, payroll export to Sage and a staff self-service portal for 340 staff across 6 branches.",
        "requirements": [
          "Leave policies per branch (6 branches, 340 staff)",
          "Payroll export compatible with Sage 300",
          "Staff self-service portal with Microsoft 365 sign-in",
          "Read-only HR dashboard for branch managers"
        ],
        "start": "2026-10-21T06:00:00.000Z"
      }
    },
    {
      "id": "d5",
      "companyId": "c10",
      "contactId": "p10",
      "title": "Property management system",
      "service": "Property Management",
      "stage": "Proposal Sent",
      "value": 600000,
      "ownerId": "s2",
      "close": "2026-10-30T06:00:00.000Z",
      "source": "Existing Customer",
      "createdAt": "2026-09-10T06:00:00.000Z"
    },
    {
      "id": "d6",
      "companyId": "c9",
      "contactId": "p9",
      "title": "School website and parent portal",
      "service": "Web Development",
      "stage": "Closed Won",
      "value": 180000,
      "ownerId": "s1",
      "close": "2026-08-05T06:00:00.000Z",
      "source": "Referral",
      "createdAt": "2026-06-02T06:00:00.000Z",
      "wonAt": "2026-08-05T07:00:00.000Z",
      "handoff": {
        "ownerId": "dl",
        "scope": "Website and parent portal.",
        "requirements": [],
        "start": "2026-08-10T06:00:00.000Z"
      }
    },
    {
      "id": "d7",
      "companyId": "c10",
      "contactId": "p10",
      "title": "Starlink for 3 managed blocks",
      "service": "Starlink / Internet",
      "stage": "Closed Won",
      "value": 210000,
      "ownerId": "s2",
      "close": "2026-03-01T06:00:00.000Z",
      "source": "Phone",
      "createdAt": "2026-02-10T06:00:00.000Z",
      "wonAt": "2026-03-01T06:00:00.000Z",
      "handoff": {
        "ownerId": "dl",
        "scope": "Starlink kits and mesh Wi-Fi for 3 blocks.",
        "requirements": [],
        "start": "2026-03-05T06:00:00.000Z"
      }
    },
    {
      "id": "d8",
      "companyId": "c9",
      "contactId": "p9",
      "title": "Campus CCTV",
      "service": "CCTV",
      "stage": "Closed Lost",
      "value": 280000,
      "ownerId": "s1",
      "close": "2026-09-30T06:00:00.000Z",
      "source": "Existing Customer",
      "createdAt": "2026-08-01T06:00:00.000Z",
      "lostReason": "Timing"
    }
  ],
  "tasks": [
    {
      "id": "t1",
      "title": "Follow up with Naivas procurement on ISP billing quote",
      "assigneeId": "s2",
      "due": "2026-10-06T12:17:00.000Z",
      "priority": "Medium",
      "status": "Pending",
      "link": {
        "type": "lead",
        "id": "l4"
      }
    },
    {
      "id": "t2",
      "title": "Send inventory system proposal to Brookside Dairy",
      "assigneeId": "s1",
      "due": "2026-10-09T12:17:00.000Z",
      "priority": "High",
      "status": "Pending",
      "link": {
        "type": "deal",
        "id": "d1"
      }
    },
    {
      "id": "t4",
      "title": "Schedule CCTV site visit at Sarova Hotels",
      "assigneeId": "s1",
      "due": "2026-10-11T12:17:00.000Z",
      "priority": "Medium",
      "status": "Pending",
      "link": {
        "type": "deal",
        "id": "d3"
      }
    },
    {
      "id": "t5",
      "title": "Acknowledge and qualify website lead from Amara Osei",
      "assigneeId": "mg",
      "due": "2026-10-19T14:00:00.000Z",
      "priority": "High",
      "status": "Pending",
      "link": {
        "type": "lead",
        "id": "l6"
      },
      "desc": "Website enquiry: portfolio site with booking."
    },
    {
      "id": "t6",
      "title": "Call Wanjiku about the social media retainer",
      "assigneeId": "s1",
      "due": "2026-10-19T13:30:00.000Z",
      "priority": "High",
      "status": "Pending",
      "link": {
        "type": "lead",
        "id": "l5"
      }
    },
    {
      "id": "t7",
      "title": "Confirm units managed and current system with Two Rivers",
      "assigneeId": "s2",
      "due": "2026-10-19T13:00:00.000Z",
      "priority": "Medium",
      "status": "Pending",
      "link": {
        "type": "lead",
        "id": "l2"
      }
    },
    {
      "id": "t8",
      "title": "Chase Artcaffe on proposal approval",
      "assigneeId": "s2",
      "due": "2026-10-21T07:00:00.000Z",
      "priority": "Medium",
      "status": "Pending",
      "link": {
        "type": "deal",
        "id": "d2"
      }
    },
    {
      "id": "t3",
      "title": "Prepare signed contract for Davis & Shirtliff",
      "assigneeId": "s2",
      "due": "2026-10-09T12:17:00.000Z",
      "priority": "High",
      "status": "Completed",
      "link": {
        "type": "deal",
        "id": "d4"
      },
      "doneAt": "2026-10-15T10:00:00.000Z"
    },
    {
      "id": "t9",
      "title": "Kickoff call with Davis & Shirtliff HR team",
      "assigneeId": "dl",
      "due": "2026-10-21T07:00:00.000Z",
      "priority": "High",
      "status": "Pending",
      "link": {
        "type": "company",
        "id": "c1"
      }
    },
    {
      "id": "t10",
      "title": "Collect employee data template from Davis & Shirtliff",
      "assigneeId": "dl",
      "due": "2026-10-19T14:00:00.000Z",
      "priority": "Medium",
      "status": "Pending",
      "link": {
        "type": "company",
        "id": "c1"
      }
    },
    {
      "id": "t11",
      "title": "Set up HR portal staging environment",
      "assigneeId": "tc",
      "due": "2026-10-23T14:00:00.000Z",
      "priority": "High",
      "status": "In progress",
      "link": {
        "type": "company",
        "id": "c1"
      },
      "desc": "Microsoft 365 sign-in, 6 branches seeded."
    },
    {
      "id": "t12",
      "title": "Design portal login and leave request screens",
      "assigneeId": "tc",
      "due": "2026-10-24T14:00:00.000Z",
      "priority": "Medium",
      "status": "Pending",
      "link": {
        "type": "company",
        "id": "c1"
      }
    },
    {
      "id": "t13",
      "title": "Hosting renewal call with Hillcrest bursar",
      "assigneeId": "s1",
      "due": "2026-10-28T07:00:00.000Z",
      "priority": "Low",
      "status": "Pending",
      "link": {
        "type": "company",
        "id": "c9"
      }
    },
    {
      "id": "t14",
      "title": "Weekly pipeline review",
      "assigneeId": "mg",
      "due": "2026-10-20T06:00:00.000Z",
      "priority": "Medium",
      "status": "Pending",
      "link": null
    },
    {
      "id": "t15",
      "title": "Reconnect with Kileleshwa Property Managers",
      "assigneeId": "s2",
      "due": "2026-10-22T08:00:00.000Z",
      "priority": "Low",
      "status": "Pending",
      "link": {
        "type": "company",
        "id": "c10"
      }
    }
  ],
  "activities": [
    {
      "id": "a100",
      "rt": "lead",
      "rid": "l2",
      "kind": "call",
      "byId": "s2",
      "at": "2026-10-16T08:00:00.000Z",
      "text": "Call with Wafula: 210 units, 188 occupied, billing on Excel. Wants a demo.",
      "outcome": "Interested"
    },
    {
      "id": "a101",
      "rt": "lead",
      "rid": "l2",
      "kind": "whatsapp",
      "byId": "s2",
      "at": "2026-10-17T06:30:00.000Z",
      "text": "Sent demo slots on WhatsApp."
    },
    {
      "id": "a102",
      "rt": "lead",
      "rid": "l2",
      "kind": "status",
      "byId": "s2",
      "at": "2026-10-17T06:32:00.000Z",
      "text": "Status changed from Contacted to Needs Identified"
    },
    {
      "id": "a103",
      "rt": "lead",
      "rid": "l5",
      "kind": "call",
      "byId": "s1",
      "at": "2026-10-10T07:00:00.000Z",
      "text": "Intro call. Budget ~KES 90k / month, wants a November start.",
      "outcome": "Qualified"
    },
    {
      "id": "a104",
      "rt": "lead",
      "rid": "l6",
      "kind": "system",
      "byId": null,
      "at": "2026-10-19T06:40:00.000Z",
      "text": "Website enquiry received. Acknowledgement email sent automatically."
    },
    {
      "id": "a105",
      "rt": "lead",
      "rid": "l4",
      "kind": "system",
      "byId": null,
      "at": "2026-09-29T06:00:00.000Z",
      "text": "Website enquiry received. Acknowledgement email sent automatically."
    },
    {
      "id": "a106",
      "rt": "lead",
      "rid": "l4",
      "kind": "email",
      "byId": "s2",
      "at": "2026-10-01T07:00:00.000Z",
      "text": "Sent ISP billing overview and pricing tiers."
    },
    {
      "id": "a107",
      "rt": "deal",
      "rid": "d3",
      "kind": "meeting",
      "byId": "s1",
      "at": "2026-10-02T07:00:00.000Z",
      "text": "Site walk at Sarova Stanley with GM."
    },
    {
      "id": "a108",
      "rt": "deal",
      "rid": "d3",
      "kind": "stage",
      "byId": "s1",
      "at": "2026-10-12T08:00:00.000Z",
      "text": "Stage moved from Proposal Sent to Negotiation"
    },
    {
      "id": "a109",
      "rt": "deal",
      "rid": "d3",
      "kind": "call",
      "byId": "s1",
      "at": "2026-10-17T12:00:00.000Z",
      "text": "Nyambura asked for a 6% discount on the 5-property bundle.",
      "outcome": "Negotiating"
    },
    {
      "id": "a110",
      "rt": "deal",
      "rid": "d2",
      "kind": "email",
      "byId": "s2",
      "at": "2026-10-14T06:00:00.000Z",
      "text": "Proposal P-2026-014 sent to Njoroge."
    },
    {
      "id": "a111",
      "rt": "deal",
      "rid": "d2",
      "kind": "whatsapp",
      "byId": "s2",
      "at": "2026-10-16T09:00:00.000Z",
      "text": "Njoroge: reviewing with the board on Thursday."
    },
    {
      "id": "a112",
      "rt": "deal",
      "rid": "d1",
      "kind": "meeting",
      "byId": "s1",
      "at": "2026-10-02T07:00:00.000Z",
      "text": "Presented the inventory solution at Ruiru depot."
    },
    {
      "id": "a113",
      "rt": "deal",
      "rid": "d5",
      "kind": "email",
      "byId": "s2",
      "at": "2026-10-01T08:00:00.000Z",
      "text": "Sent property management proposal."
    },
    {
      "id": "a114",
      "rt": "deal",
      "rid": "d4",
      "kind": "stage",
      "byId": "s2",
      "at": "2026-10-15T11:00:00.000Z",
      "text": "Stage moved from Negotiation to Closed Won"
    },
    {
      "id": "a115",
      "rt": "deal",
      "rid": "d4",
      "kind": "handoff",
      "byId": "s2",
      "at": "2026-10-15T11:02:00.000Z",
      "text": "Handed off to Delivery. Owner: Dev Delivery. Onboarding template applied (4 tasks)."
    },
    {
      "id": "a116",
      "rt": "company",
      "rid": "c1",
      "kind": "handoff",
      "byId": "s2",
      "at": "2026-10-15T11:02:00.000Z",
      "text": "Lifecycle moved to Onboarding after HR automation was won."
    },
    {
      "id": "a117",
      "rt": "company",
      "rid": "c1",
      "kind": "call",
      "byId": "dl",
      "at": "2026-10-16T06:00:00.000Z",
      "text": "Intro call with Mutiso. Kickoff booked for 21 Oct."
    },
    {
      "id": "a118",
      "rt": "company",
      "rid": "c9",
      "kind": "email",
      "byId": "s1",
      "at": "2026-08-20T06:00:00.000Z",
      "text": "Website handover pack sent to the bursar."
    },
    {
      "id": "a119",
      "rt": "company",
      "rid": "c10",
      "kind": "call",
      "byId": "s2",
      "at": "2026-07-17T06:00:00.000Z",
      "text": "Check-in call. All three blocks online."
    }
  ],
  "recurring": [
    {
      "id": "r1",
      "companyId": "c9",
      "service": "Website hosting and maintenance",
      "cycle": "Yearly",
      "value": 36000,
      "renews": "2026-11-15T06:00:00.000Z",
      "ownerId": "s1"
    },
    {
      "id": "r2",
      "companyId": "c10",
      "service": "Starlink data plan · 3 blocks",
      "cycle": "Yearly",
      "value": 84000,
      "renews": "2026-12-03T06:00:00.000Z",
      "ownerId": "s2"
    },
    {
      "id": "r3",
      "companyId": "c1",
      "service": "HR system support retainer",
      "cycle": "Monthly",
      "value": 45000,
      "renews": "2027-01-14T21:00:00.000Z",
      "ownerId": "s2"
    }
  ],
  "notifications": [
    {
      "id": "n1",
      "type": "Lead assigned",
      "to": [
        "s1"
      ],
      "text": "Twiga Foods was assigned to you",
      "at": "2026-10-16T06:31:00.000Z",
      "read": false,
      "link": [
        "lead",
        "l3"
      ]
    },
    {
      "id": "n2",
      "type": "Website lead",
      "to": [
        "mg"
      ],
      "text": "New website lead: Amara Osei (Web Development) · unassigned",
      "at": "2026-10-19T06:40:00.000Z",
      "read": false,
      "link": [
        "lead",
        "l6"
      ]
    },
    {
      "id": "n3",
      "type": "Task overdue",
      "to": [
        "s1"
      ],
      "text": "“Send inventory system proposal to Brookside Dairy” is 10 days overdue",
      "at": "2026-10-19T05:00:00.000Z",
      "read": false,
      "link": [
        "task",
        "t2"
      ]
    },
    {
      "id": "n4",
      "type": "Task overdue",
      "to": [
        "s2"
      ],
      "text": "“Follow up with Naivas procurement” is 13 days overdue",
      "at": "2026-10-19T05:00:00.000Z",
      "read": false,
      "link": [
        "task",
        "t1"
      ]
    },
    {
      "id": "n5",
      "type": "Handoff",
      "to": [
        "dl",
        "mg"
      ],
      "text": "Davis & Shirtliff · HR automation was won and handed to Delivery",
      "at": "2026-10-15T11:02:00.000Z",
      "read": false,
      "link": [
        "company",
        "c1"
      ]
    },
    {
      "id": "n6",
      "type": "Task due",
      "to": [
        "dl"
      ],
      "text": "Collect employee data template is due today at 5:00 PM",
      "at": "2026-10-19T05:00:00.000Z",
      "read": false,
      "link": [
        "task",
        "t10"
      ]
    },
    {
      "id": "n7",
      "type": "Task assigned",
      "to": [
        "tc"
      ],
      "text": "You were assigned “Set up HR portal staging environment”",
      "at": "2026-10-16T07:00:00.000Z",
      "read": false,
      "link": [
        "task",
        "t11"
      ]
    },
    {
      "id": "n8",
      "type": "Payment overdue",
      "to": [
        "fn",
        "mg"
      ],
      "text": "INV-0322 for Kileleshwa Property Managers is 19 days overdue",
      "at": "2026-10-19T05:00:00.000Z",
      "read": false,
      "link": [
        "finance",
        null
      ]
    },
    {
      "id": "n9",
      "type": "Stalled deal",
      "to": [
        "s2",
        "mg"
      ],
      "text": "Kileleshwa · Property management system has had no activity for 18 days",
      "at": "2026-10-19T05:00:00.000Z",
      "read": true,
      "link": [
        "deal",
        "d5"
      ]
    },
    {
      "id": "n10",
      "type": "Deal won",
      "to": [
        "fn"
      ],
      "text": "Davis & Shirtliff · HR automation won: KES 1,250,000 ready to invoice",
      "at": "2026-10-15T11:02:00.000Z",
      "read": true,
      "link": [
        "finance",
        null
      ]
    },
    {
      "id": "n11",
      "type": "Renewal",
      "to": [
        "s1",
        "mg"
      ],
      "text": "Hillcrest hosting renewal due in 27 days",
      "at": "2026-10-18T05:00:00.000Z",
      "read": true,
      "link": [
        "company",
        "c9"
      ]
    }
  ]
};
