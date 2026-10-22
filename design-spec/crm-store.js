(function(){
if (window.FB) return;
const NOW = new Date(2026,9,19,15,12);
const at=(day,h=9,m=0,mon=9)=>new Date(2026,mon,day,h,m);
const DAY=864e5;

const ROLES={management:'Management',sales:'Sales',delivery:'Delivery',finance:'Finance',technical:'Restricted Technical',support:'Customer Support (proposed)',platform:'Platform Super Admin'};
const users=[
 {id:'mg',name:'Dev Management',email:'management@figbloom.co.ke',role:'management'},
 {id:'s1',name:'Dev Sales',email:'sales@figbloom.co.ke',role:'sales'},
 {id:'s2',name:'Dev Sales Two',email:'sales2@figbloom.co.ke',role:'sales'},
 {id:'dl',name:'Dev Delivery',email:'delivery@figbloom.co.ke',role:'delivery'},
 {id:'fn',name:'Dev Finance',email:'finance@figbloom.co.ke',role:'finance'},
 {id:'tc',name:'Dev Restricted Technical',email:'tech@figbloom.co.ke',role:'technical'},
 {id:'cs',name:'Dev Customer Support',email:'support@figbloom.co.ke',role:'support'},
 {id:'pa',name:'Dev Super Admin',email:'superadmin@platform.figbloom.co.ke',role:'platform',platform:true},
];
const ref={
 sources:['Website','WhatsApp','Phone','Email','Facebook','Instagram','LinkedIn','TikTok','Referral','Existing Customer','Direct Outreach','Physical Meeting','Networking','Advertising','Other'],
 statuses:['New','Qualified','Contacted','Needs Identified','Unqualified','Converted','Lost','Inactive'],
 stages:['Solution Presented','Proposal Sent','Negotiation','Closed Won','Closed Lost'],
 lostReasons:['Not Interested','Not Qualified','No Budget','Competitor','No Need','Wrong Contact','No Response','Timing','Location','Duplicate','Other'],
 services:['Accounting','HR','CRM','Inventory','Property Management','Fleet / GPS','CCTV','Starlink / Internet','ISP Billing','Web Development','Branding','Social Media Management','Automation Systems','Consulting / Other'],
 lifecycle:['Prospect','Customer','Onboarding','Active Customer','Dormant Customer','Renewal'],
 temps:['Hot','Warm','Cold'],
 onboarding:['Kickoff call with client','Collect requirements and system access','Confirm scope and deliverables in writing','Schedule first delivery check-in'],
};
const companies=[
 {id:'c1',name:'Davis & Shirtliff',industry:'Engineering',lifecycle:'Onboarding',ownerId:'s2',phone:'+254 20 696 8000',email:'info@davisandshirtliff.com',website:'davisandshirtliff.com',location:'Industrial Area, Nairobi',createdAt:at(2,10,0,8),services:[{name:'HR',label:'HR automation (leave, payroll export, self-service)',status:'Onboarding',since:'Oct 2026'}],issues:['Payroll export format still to be confirmed by their finance team']},
 {id:'c2',name:'Sarova Hotels',industry:'Hospitality',lifecycle:'Prospect',ownerId:'s1',phone:'+254 709 111 000',email:'reservations@sarovahotels.com',website:'sarovahotels.com',location:'Westlands, Nairobi',createdAt:at(4,9,0,8),services:[],issues:[]},
 {id:'c3',name:'Two Rivers Mall',industry:'Real Estate',lifecycle:'Prospect',ownerId:'s2',phone:'+254 709 980 000',email:'info@tworiversmall.co.ke',website:'tworiversmall.co.ke',location:'Ruaka, Kiambu',createdAt:at(9,9,0,8),services:[],issues:[]},
 {id:'c4',name:'Brookside Dairy',industry:'Manufacturing',lifecycle:'Prospect',ownerId:'s1',phone:'+254 20 356 0000',email:'info@brookside.co.ke',website:'brookside.co.ke',location:'Ruiru',createdAt:at(12,9,0,8),services:[],issues:[]},
 {id:'c5',name:'Artcaffe Group',industry:'Hospitality',lifecycle:'Prospect',ownerId:'s2',phone:'+254 711 000 222',email:'hello@artcaffe.co.ke',website:'artcaffe.co.ke',location:'Westlands, Nairobi',createdAt:at(15,9,0,8),services:[],issues:[]},
 {id:'c6',name:'Twiga Foods',industry:'Logistics',lifecycle:'Prospect',ownerId:'s1',phone:'+254 709 258 000',email:'info@twiga.com',website:'twiga.com',location:'Tatu City',createdAt:at(1,9,0,9),services:[],issues:[]},
 {id:'c7',name:'Naivas Supermarket',industry:'Retail',lifecycle:'Prospect',ownerId:'s2',phone:'+254 709 676 000',email:'procurement@naivas.co.ke',website:'naivas.co.ke',location:'Nairobi CBD',createdAt:at(3,9,0,9),services:[],issues:[]},
 {id:'c8',name:'Java House Africa',industry:'Hospitality',lifecycle:'Prospect',ownerId:'s1',phone:'+254 719 058 000',email:'marketing@javahouseafrica.com',website:'javahouseafrica.com',location:'Kilimani, Nairobi',createdAt:at(6,9,0,9),services:[],issues:[]},
 {id:'c9',name:'Hillcrest Preparatory School',industry:'Education',lifecycle:'Active Customer',ownerId:'s1',phone:'+254 722 203 000',email:'bursar@hillcrest.ac.ke',website:'hillcrest.ac.ke',location:'Lang\u2019ata, Nairobi',createdAt:at(2,9,0,5),renewal:at(15,9,0,10),services:[{name:'Web Development',label:'School website and parent portal',status:'Live',since:'Aug 2026'},{name:'Starlink / Internet',label:'Campus Starlink kit (hosting renewal due)',status:'Renewal due 15 Nov',since:'Jun 2026'}],issues:['Parent portal login reset emails landing in spam']},
 {id:'c10',name:'Kileleshwa Property Managers',industry:'Property Management',lifecycle:'Dormant Customer',ownerId:'s2',phone:'+254 733 411 900',email:'admin@kpm.co.ke',website:'kpm.co.ke',location:'Kileleshwa, Nairobi',createdAt:at(10,9,0,1),renewal:at(3,9,0,11),lastTouch:at(17,9,0,6),services:[{name:'Starlink / Internet',label:'Starlink for 3 managed blocks',status:'Live',since:'Mar 2026'}],issues:['Second instalment overdue since 30 Sep']},
];
const contacts=[
 {id:'p1',first:'Mutiso',last:'Kyalo',title:'Engineering Lead',department:'Engineering',social:'linkedin.com/in/mutisokyalo',companyId:'c1',email:'mutiso.kyalo@davisshirtliff.co.ke',phone:'+254712345608',ownerId:'s2'},
 {id:'p2',first:'Nyambura',last:'Githinji',title:'General Manager',department:'Management',social:'linkedin.com/in/nyamburag',companyId:'c2',email:'nyambura.githinji@sarovahotels.co.ke',phone:'+254712345607',ownerId:'s1'},
 {id:'p3',first:'Wafula',last:'Simiyu',title:'Facilities Manager',companyId:'c3',email:'wafula.simiyu@tworiversmall.co.ke',phone:'+254712345606',ownerId:'s2'},
 {id:'p4',first:'Chebet',last:'Kiprono',title:'Supply Chain Manager',companyId:'c4',email:'chebet.kiprono@brooksidedairy.co.ke',phone:'+254712345605',ownerId:'s1'},
 {id:'p5',first:'Njoroge',last:'Mwangi',title:'Finance Director',companyId:'c5',email:'njoroge.mwangi@artcaffegroup.co.ke',phone:'+254712345604',ownerId:'s2'},
 {id:'p6',first:'Akinyi',last:'Owino',title:'IT Manager',companyId:'c6',email:'akinyi.owino@twigafoods.co.ke',phone:'+254712345603',ownerId:'s1'},
 {id:'p7',first:'Otieno',last:'Odhiambo',title:'Procurement Lead',companyId:'c7',email:'otieno.odhiambo@naivassupermarket.co.ke',phone:'+254712345602',ownerId:'s2'},
 {id:'p8',first:'Wanjiku',last:'Kamau',title:'Marketing Manager',department:'Marketing',social:'instagram.com/javahouseafrica',companyId:'c8',email:'wanjiku.kamau@javahouseafrica.com',phone:'+254712345601',ownerId:'s1'},
 {id:'p9',first:'Grace',last:'Achieng',title:'Bursar',companyId:'c9',email:'grace.achieng@hillcrest.ac.ke',phone:'+254722556301',ownerId:'s1'},
 {id:'p10',first:'Peter',last:'Ndungu',title:'Operations Director',companyId:'c10',email:'peter@kpm.co.ke',phone:'+254733411902',ownerId:'s2'},
 {id:'p11',first:'Amara',last:'Osei',title:'Founder, Osei Studio',companyId:null,email:'amara@oseistudio.co.ke',phone:'+254700412233',ownerId:null},
 {id:'p12',first:'Live Verify',last:'FB Lead',title:'',companyId:null,email:'',phone:'+254700099999',ownerId:'s1'},
];
const leads=[
 {id:'l1',companyId:'c2',contactId:'p2',name:'Sarova Hotels',status:'New',temp:'Warm',source:'Instagram',service:'Starlink / Internet',ownerId:'s2',next:at(21,10,0),createdAt:at(14,11,0),qual:{units:'5 properties',occupied:'',provider:'Safaricom Fibre'},notes:'Asked about backup internet for the coast properties.'},
 {id:'l2',companyId:'c3',contactId:'p3',name:'Two Rivers Mall',status:'Needs Identified',temp:'Hot',source:'Direct Outreach',service:'Property Management',ownerId:'s2',next:at(19,16,0),createdAt:at(2,10,0),qual:{units:'210 retail units',occupied:'188',provider:'Excel + email'},notes:'Wants tenant billing and service charge tracking.'},
 {id:'l3',companyId:'c6',contactId:'p6',name:'Twiga Foods',status:'New',temp:'Warm',source:'LinkedIn',service:'Fleet / GPS',ownerId:'s1',next:at(20,11,0),createdAt:at(16,9,30),qual:{vehicles:'64 trucks'},notes:''},
 {id:'l4',companyId:'c7',contactId:'p7',name:'Naivas Supermarket',status:'Contacted',temp:'Warm',source:'Website',service:'ISP Billing',ownerId:'s2',next:at(6,15,17),createdAt:at(29,9,0,8),website:true,ack:'Acknowledged automatically · 29 Sep',web:{message:'We need a billing system for our in-store ISP hotspots across 12 branches.',budget:'KES 200k – 500k',utm:'utm_source=google · utm_medium=cpc · utm_campaign=isp-billing'},qual:{},notes:'Enquiry via website form.'},
 {id:'l5',companyId:'c8',contactId:'p8',name:'Java House Africa',status:'Qualified',temp:'Hot',source:'Referral',service:'Social Media Management',ownerId:'s1',next:at(19,16,30),createdAt:at(8,14,0),qual:{budget:'KES 90,000 / month',timeline:'Start November',decision:'Wanjiku Kamau'},notes:'Referred by Artcaffe. Wants a 6-month retainer.'},
 {id:'l6',companyId:null,contactId:'p11',name:'Amara Osei',status:'New',temp:'Hot',source:'Website',service:'Web Development',ownerId:null,next:at(19,17,0),createdAt:at(19,9,40),website:true,ack:'Acknowledged automatically · today 09:40',web:{message:'Portfolio site with online booking for my design studio. Launch before December.',budget:'Under KES 100k',utm:'utm_source=facebook · utm_medium=paid_social · utm_campaign=oct-web'},qual:{},notes:'Portfolio site with booking for a design studio.'},
 {id:'l7',companyId:null,contactId:'p12',name:'Live Verify FB Lead',status:'New',temp:'Cold',source:'Facebook',service:'Branding',ownerId:'s1',next:null,createdAt:at(19,8,5),qual:{},notes:'Test lead from Facebook Lead Ads.'},
 {id:'l8',companyId:null,contactId:null,name:'Greenpark Estates',status:'Lost',temp:'Cold',source:'Phone',service:'Property Management',ownerId:'s2',next:null,createdAt:at(5,9,0,8),lostReason:'No Budget',archived:true,qual:{}},
 {id:'l9',companyId:null,contactId:null,name:'Riverside Clinic',status:'Unqualified',temp:'Cold',source:'TikTok',service:'Consulting / Other',ownerId:'s1',next:null,createdAt:at(12,9,0,8),archived:true,qual:{}},
 {id:'l10',companyId:'c1',contactId:'p1',name:'Davis & Shirtliff',status:'Converted',temp:'Hot',source:'Networking',service:'HR',ownerId:'s2',next:null,createdAt:at(2,9,0,8),dealId:'d4',qual:{},notes:'Converted to deal in August.'},
 {id:'l11',companyId:'c9',contactId:'p9',name:'Hillcrest Preparatory School',status:'Converted',temp:'Warm',source:'Referral',service:'Web Development',ownerId:'s1',next:null,createdAt:at(10,9,0,6),dealId:'d6',qual:{},notes:''},
 {id:'l12',companyId:'c10',contactId:'p10',name:'Kileleshwa Property Managers',status:'Converted',temp:'Warm',source:'Phone',service:'Starlink / Internet',ownerId:'s2',next:null,createdAt:at(20,9,0,0),dealId:'d7',qual:{},notes:''},
];
const deals=[
 {id:'d1',companyId:'c4',contactId:'p4',title:'Inventory system for 3 depots',service:'Inventory',stage:'Solution Presented',value:450000,cost:270000,ownerId:'s1',close:at(1,9,0,11),source:'Referral',lastActivity:at(2,10,0),createdAt:at(20,9,0,8),proposals:[]},
 {id:'d2',companyId:'c5',contactId:'p5',title:'Website rebuild and online ordering',service:'Web Development',stage:'Proposal Sent',value:320000,cost:180000,ownerId:'s2',close:at(15,9,0,10),source:'Instagram',lastActivity:at(16,12,0),createdAt:at(25,9,0,8),proposals:[{no:'P-2026-014',status:'Sent',amount:320000,sent:'14 Oct 2026',sentAt:at(14,9,0),approval:'Awaiting client',doc:'Drive / Proposals / Artcaffe-web-v2.pdf'}]},
 {id:'d3',companyId:'c2',contactId:'p2',title:'CCTV across 5 properties',service:'CCTV',stage:'Negotiation',value:980000,cost:690000,ownerId:'s1',close:at(20,9,0,10),source:'Physical Meeting',lastActivity:at(17,15,0),createdAt:at(1,9,0,8),proposals:[{no:'P-2026-011',status:'Revised',amount:1040000,sent:'2 Oct 2026',approval:'Superseded',doc:'Drive / Proposals / Sarova-cctv-v1.pdf'},{no:'P-2026-013',status:'Sent',amount:980000,sent:'12 Oct 2026',sentAt:at(12,9,0),approval:'Under negotiation',doc:'Drive / Proposals / Sarova-cctv-v2.pdf'}]},
 {id:'d4',companyId:'c1',contactId:'p1',title:'HR automation rollout',service:'HR',stage:'Closed Won',value:1250000,cost:820000,ownerId:'s2',close:at(30,9,0,9),source:'Networking',lastActivity:at(16,9,0),createdAt:at(2,9,0,8),wonAt:at(15,14,0),proposals:[{no:'P-2026-009',status:'Approved',amount:1250000,sent:'24 Sep 2026',approval:'Signed 15 Oct',doc:'Drive / Contracts / DS-HR-signed.pdf'}],
  handoff:{ownerId:'dl',start:at(21,9,0),status:'Onboarding',team:['dl','tc'],scope:'Leave management, payroll export to Sage and a staff self-service portal for 340 staff across 6 branches.',requirements:['Leave policies per branch (6 branches, 340 staff)','Payroll export compatible with Sage 300','Staff self-service portal with Microsoft 365 sign-in','Read-only HR dashboard for branch managers'],deliverables:[{t:'Requirements sign-off',done:true},{t:'Staging environment',done:false},{t:'Leave module',done:false},{t:'Payroll export',done:false},{t:'Staff training (2 sessions)',done:false}],notes:'Client prefers updates by WhatsApp to Mutiso. Go-live target 15 Dec.'}},
 {id:'d5',companyId:'c10',contactId:'p10',title:'Property management system',service:'Property Management',stage:'Proposal Sent',value:600000,cost:380000,ownerId:'s2',close:at(30,9,0,9),source:'Existing Customer',lastActivity:at(1,11,0),createdAt:at(10,9,0,8),proposals:[{no:'P-2026-012',status:'Sent',amount:600000,sent:'1 Oct 2026',sentAt:at(1,11,0),approval:'No response',doc:'Drive / Proposals / KPM-pms.pdf'}]},
 {id:'d6',companyId:'c9',contactId:'p9',title:'School website and parent portal',service:'Web Development',stage:'Closed Won',value:180000,ownerId:'s1',close:at(5,9,0,7),source:'Referral',lastActivity:at(20,9,0,7),createdAt:at(2,9,0,5),wonAt:at(5,10,0,7),proposals:[],handoff:{ownerId:'dl',start:at(10,9,0,7),status:'Delivered',team:['dl'],scope:'Website and parent portal.',requirements:[],deliverables:[{t:'Website live',done:true},{t:'Parent portal',done:true}],notes:''}},
 {id:'d7',companyId:'c10',contactId:'p10',title:'Starlink for 3 managed blocks',service:'Starlink / Internet',stage:'Closed Won',value:210000,ownerId:'s2',close:at(1,9,0,2),source:'Phone',lastActivity:at(17,9,0,6),createdAt:at(10,9,0,1),wonAt:at(1,9,0,2),proposals:[],handoff:{ownerId:'dl',start:at(5,9,0,2),status:'Delivered',team:['dl'],scope:'Starlink kits and mesh Wi-Fi for 3 blocks.',requirements:[],deliverables:[{t:'Kits installed',done:true}],notes:''}},
 {id:'d8',companyId:'c9',contactId:'p9',title:'Campus CCTV',service:'CCTV',stage:'Closed Lost',value:280000,ownerId:'s1',close:at(30,9,0,8),source:'Existing Customer',lastActivity:at(28,9,0,8),createdAt:at(1,9,0,7),lostReason:'Timing',proposals:[]},
];
const tasks=[
 {id:'t1',title:'Follow up with Naivas procurement on ISP billing quote',assigneeId:'s2',due:at(6,15,17),priority:'Medium',status:'Pending',link:{type:'lead',id:'l4'}},
 {id:'t2',title:'Send inventory system proposal to Brookside Dairy',assigneeId:'s1',due:at(9,15,17),priority:'High',status:'Pending',link:{type:'deal',id:'d1'}},
 {id:'t4',title:'Schedule CCTV site visit at Sarova Hotels',assigneeId:'s1',due:at(11,15,17),priority:'Medium',status:'Pending',link:{type:'deal',id:'d3'}},
 {id:'t5',title:'Acknowledge and qualify website lead from Amara Osei',desc:'Website enquiry: portfolio site with booking.',assigneeId:'mg',due:at(19,17,0),priority:'High',status:'Pending',link:{type:'lead',id:'l6'}},
 {id:'t6',title:'Call Wanjiku about the social media retainer',assigneeId:'s1',due:at(19,16,30),priority:'High',status:'Pending',link:{type:'lead',id:'l5'}},
 {id:'t7',title:'Confirm units managed and current system with Two Rivers',assigneeId:'s2',due:at(19,16,0),priority:'Medium',status:'Pending',link:{type:'lead',id:'l2'}},
 {id:'t8',title:'Chase Artcaffe on proposal approval',assigneeId:'s2',due:at(21,10,0),priority:'Medium',status:'Pending',link:{type:'deal',id:'d2'}},
 {id:'t3',title:'Prepare signed contract for Davis & Shirtliff',assigneeId:'s2',due:at(9,15,17),priority:'High',status:'Completed',doneAt:at(15,13,0),link:{type:'deal',id:'d4'}},
 {id:'t9',title:'Kickoff call with Davis & Shirtliff HR team',assigneeId:'dl',due:at(21,10,0),priority:'High',status:'Pending',link:{type:'company',id:'c1'},onboarding:true},
 {id:'t10',title:'Collect employee data template from Davis & Shirtliff',assigneeId:'dl',due:at(19,17,0),priority:'Medium',status:'Pending',link:{type:'company',id:'c1'},onboarding:true},
 {id:'t11',title:'Set up HR portal staging environment',desc:'Microsoft 365 sign-in, 6 branches seeded.',assigneeId:'tc',due:at(23,17,0),priority:'High',status:'In progress',link:{type:'company',id:'c1'},req:['Staff self-service portal with Microsoft 365 sign-in','Leave policies per branch (6 branches, 340 staff)']},
 {id:'t12',title:'Design portal login and leave request screens',assigneeId:'tc',due:at(24,17,0),priority:'Medium',status:'Pending',link:{type:'company',id:'c1'},req:['Staff self-service portal with Microsoft 365 sign-in','Read-only HR dashboard for branch managers']},
 {id:'t13',title:'Hosting renewal call with Hillcrest bursar',assigneeId:'s1',due:at(28,10,0),priority:'Low',status:'Pending',link:{type:'company',id:'c9'}},
 {id:'t14',title:'Weekly pipeline review',assigneeId:'mg',due:at(20,9,0),priority:'Medium',status:'Pending',link:null},
 {id:'t15',title:'Reconnect with Kileleshwa Property Managers',assigneeId:'s2',due:at(22,11,0),priority:'Low',status:'Pending',link:{type:'company',id:'c10'}},
];
const payments=[
 {dealId:'d4',contract:1250000,invoices:[{no:'INV-0412',label:'Deposit (50%)',amount:625000,issued:'16 Oct 2026',due:'30 Oct 2026',status:'Sent'},{no:'—',label:'Balance on go-live',amount:625000,issued:'',due:'15 Dec 2026',status:'Not invoiced'}],next:'Confirm deposit received by 30 Oct'},
 {dealId:'d6',contract:180000,invoices:[{no:'INV-0388',label:'Full amount',amount:180000,issued:'5 Aug 2026',due:'20 Aug 2026',status:'Paid'}],next:''},
 {dealId:'d7',contract:210000,invoices:[{no:'INV-0301',label:'Instalment 1',amount:140000,issued:'1 Feb 2026',due:'15 Feb 2026',status:'Paid'},{no:'INV-0322',label:'Instalment 2',amount:70000,issued:'15 Sep 2026',due:'30 Sep 2026',status:'Overdue'}],next:'Call Peter Ndungu about INV-0322'},
];
let aid=100;
const A=(rt,rid,kind,byId,when,text,extra)=>({id:'a'+(aid++),rt,rid,kind,byId,at:when,text,...(extra||{})});
const activities=[
 A('lead','l2','call','s2',at(16,11,0),'Call with Wafula: 210 units, 188 occupied, billing on Excel. Wants a demo.',{outcome:'Interested'}),
 A('lead','l2','whatsapp','s2',at(17,9,30),'Sent demo slots on WhatsApp.'),
 A('lead','l2','status','s2',at(17,9,32),'Status changed from Contacted to Needs Identified'),
 A('lead','l5','call','s1',at(10,10,0),'Intro call. Budget ~KES 90k / month, wants a November start.',{outcome:'Qualified'}),
 A('lead','l6','system',null,at(19,9,40),'Website enquiry received. Acknowledgement email sent automatically.'),
 A('lead','l4','system',null,at(29,9,0,8),'Website enquiry received. Acknowledgement email sent automatically.'),
 A('lead','l4','email','s2',at(1,10,0),'Sent ISP billing overview and pricing tiers.'),
 A('deal','d3','meeting','s1',at(2,10,0),'Site walk at Sarova Stanley with GM.'),
 A('deal','d3','stage','s1',at(12,11,0),'Stage moved from Proposal Sent to Negotiation'),
 A('deal','d3','call','s1',at(17,15,0),'Nyambura asked for a 6% discount on the 5-property bundle.',{outcome:'Negotiating',dir:'in'}),
 A('deal','d2','email','s2',at(14,9,0),'Proposal P-2026-014 sent to Njoroge.'),
 A('deal','d2','whatsapp','s2',at(16,12,0),'Njoroge: reviewing with the board on Thursday.',{dir:'in'}),
 A('deal','d1','meeting','s1',at(2,10,0),'Presented the inventory solution at Ruiru depot.'),
 A('deal','d5','email','s2',at(1,11,0),'Sent property management proposal.'),
 A('deal','d4','stage','s2',at(15,14,0),'Stage moved from Negotiation to Closed Won'),
 A('deal','d4','handoff','s2',at(15,14,2),'Handed off to Delivery. Owner: Dev Delivery. Onboarding template applied (4 tasks).'),
 A('company','c1','handoff','s2',at(15,14,2),'Lifecycle moved to Onboarding after HR automation was won.'),
 A('company','c1','call','dl',at(16,9,0),'Intro call with Mutiso. Kickoff booked for 21 Oct.'),
 A('company','c9','email','s1',at(20,9,0,7),'Website handover pack sent to the bursar.'),
 A('company','c10','call','s2',at(17,9,0,6),'Check-in call. All three blocks online.'),
];
const audit=[
 {at:at(19,9,40),byId:null,action:'Lead created',target:'Amara Osei',detail:'Source Website · auto-acknowledged'},
 {at:at(17,9,32),byId:'s2',action:'Lead status changed',target:'Two Rivers Mall',detail:'Contacted → Needs Identified'},
 {at:at(16,9,0),byId:'mg',action:'Member invited',target:'wanjiru@figbloom.co.ke',detail:'Role Sales'},
 {at:at(15,14,2),byId:'s2',action:'Deal won and handed off',target:'Davis & Shirtliff · HR automation',detail:'Delivery owner Dev Delivery'},
 {at:at(14,11,0),byId:'mg',action:'Lead reassigned',target:'Sarova Hotels',detail:'Dev Sales → Dev Sales Two'},
 {at:at(12,11,0),byId:'s1',action:'Deal stage changed',target:'Sarova Hotels · CCTV',detail:'Proposal Sent → Negotiation'},
 {at:at(10,16,0),byId:'mg',action:'Website API key rotated',target:'Website integration',detail:'Old key revoked'},
 {at:at(8,10,0),byId:'mg',action:'Reference data edited',target:'Lost reasons',detail:'Added “Location”'},
];
const notifications=[
 {id:'n1',type:'Lead assigned',to:['s1'],text:'Twiga Foods was assigned to you',at:at(16,9,31),read:false,link:['lead','l3']},
 {id:'n2',type:'Website lead',to:['mg'],text:'New website lead: Amara Osei (Web Development) · unassigned',at:at(19,9,40),read:false,link:['lead','l6']},
 {id:'n3',type:'Task overdue',to:['s1'],text:'“Send inventory system proposal to Brookside Dairy” is 10 days overdue',at:at(19,8,0),read:false,link:['task','t2']},
 {id:'n4',type:'Task overdue',to:['s2'],text:'“Follow up with Naivas procurement” is 13 days overdue',at:at(19,8,0),read:false,link:['task','t1']},
 {id:'n5',type:'Handoff',to:['dl','mg'],text:'Davis & Shirtliff · HR automation was won and handed to Delivery',at:at(15,14,2),read:false,link:['company','c1']},
 {id:'n6',type:'Task due',to:['dl'],text:'Collect employee data template is due today at 5:00 PM',at:at(19,8,0),read:false,link:['task','t10']},
 {id:'n7',type:'Task assigned',to:['tc'],text:'You were assigned “Set up HR portal staging environment”',at:at(16,10,0),read:false,link:['task','t11']},
 {id:'n8',type:'Payment overdue',to:['fn','mg'],text:'INV-0322 for Kileleshwa Property Managers is 19 days overdue',at:at(19,8,0),read:false,link:['finance',null]},
 {id:'n9',type:'Stalled deal',to:['s2','mg'],text:'Kileleshwa · Property management system has had no activity for 18 days',at:at(19,8,0),read:true,link:['deal','d5']},
 {id:'n10',type:'Deal won',to:['fn'],text:'Davis & Shirtliff · HR automation won: KES 1,250,000 ready to invoice',at:at(15,14,2),read:true,link:['finance',null]},
 {id:'n11',type:'Renewal',to:['s1','mg'],text:'Hillcrest hosting renewal due in 27 days',at:at(18,8,0),read:true,link:['company','c9']},
];
const members=[
 ...users.map(u=>({id:u.id,name:u.name,email:u.email,role:u.role,status:'Active',last:u.id==='tc'?'3 days ago':'Today'})),
 {id:'m7',name:'Wanjiru Mwende',email:'wanjiru@figbloom.co.ke',role:'sales',status:'Invited',last:'Invite sent 16 Oct'},
 {id:'m8',name:'Kevin Otieno',email:'kevin.o@figbloom.co.ke',role:'delivery',status:'Deactivated',last:'Deactivated 2 Sep'},
];
const submissions=[
 {at:at(19,9,40),name:'Amara Osei',service:'Web Development',result:'Created lead · acknowledged',ok:true},
 {at:at(18,22,14),name:'(blocked)',service:'—',result:'Rejected: honeypot field filled',ok:false},
 {at:at(14,13,2),name:'Grace Wairimu',service:'Branding',result:'Duplicate of an existing contact: merged into timeline',ok:true},
 {at:at(29,9,0,8),name:'Naivas Supermarket',service:'ISP Billing',result:'Created lead · assigned to Dev Sales Two by rule',ok:true},
];

const inbox=[
 {id:'i1',channel:'email',from:'faith.wambui@kenolkobil.co.ke',name:'Faith Wambui · KenolKobil',subject:'Quote for CCTV at our Thika branch',summary:'Looking for 16 cameras with remote viewing at the Thika depot. Can someone visit next week?',at:at(19,7,12),link:null},
 {id:'i2',channel:'social',from:'Facebook Messenger',name:'Brian Otieno',subject:'Do you install Starlink in Nakuru?',summary:'Hi, I saw your ad. Do you install Starlink in Nakuru and how much is the kit?',at:at(19,10,48),link:null},
 {id:'i3',channel:'email',from:'mutiso.kyalo@davisshirtliff.co.ke',name:'Mutiso Kyalo',subject:'Re: Employee data template',summary:'Attached the filled template for 4 of 6 branches. Kisumu and Mombasa by Wednesday.',at:at(19,11,5),link:{type:'company',id:'c1',contactId:'p1'}},
 {id:'i4',channel:'social',from:'Instagram DM',name:'@wanjiku.k (Java House)',subject:'Sample calendar',summary:'Can you share a sample content calendar before Thursday?',at:at(18,16,20),link:{type:'lead',id:'l5',contactId:'p8'}},
];
const recurring=[
 {id:'r1',companyId:'c9',service:'Website hosting and maintenance',cycle:'Yearly',value:36000,renews:at(15,9,0,10),ownerId:'s1',state:'Due in 27 days'},
 {id:'r2',companyId:'c10',service:'Starlink data plan · 3 blocks',cycle:'Yearly',value:84000,renews:at(3,9,0,11),ownerId:'s2',state:'Due in 45 days'},
 {id:'r3',companyId:'c1',service:'HR system support retainer',cycle:'Monthly',value:45000,renews:new Date(2027,0,15),ownerId:'s2',state:'Starts after go-live'},
];
const attachments=[
 {id:'f1',rt:'deal',rid:'d4',name:'HR-automation-SOW-v3.pdf',type:'pdf',size:'1.2 MB',by:'s2',at:at(28,10,0,8),vis:'all'},
 {id:'f2',rt:'deal',rid:'d4',name:'Signed-contract.pdf',type:'pdf',size:'640 KB',by:'s2',at:at(30,15,0,8),vis:'mgmt'},
 {id:'f3',rt:'company',rid:'c1',name:'Branch-employee-template.xlsx',type:'sheet',size:'88 KB',by:'dl',at:at(19,11,5),vis:'all'},
 {id:'f4',rt:'lead',rid:'l2',name:'Site-photos-TRM.zip',type:'zip',size:'14.8 MB',by:'s2',at:at(19,14,50),vis:'all',scan:true},
 {id:'f5',rt:'deal',rid:'d3',name:'Camera-placement-plan.png',type:'image',size:'2.1 MB',by:'s1',at:at(12,9,0),vis:'all'},
];
const tagDefs=[{id:'g1',name:'VIP',color:'red'},{id:'g2',name:'Referral partner',color:'purple'},{id:'g3',name:'Government',color:'blue'},{id:'g4',name:'Multi-site',color:'green'},{id:'g5',name:'Price sensitive',color:'orange'}];
const tagMap={'company:c1':['g1','g4'],'company:c2':['g4'],'deal:d3':['g1','g4'],'lead:l2':['g4'],'lead:l4':['g5'],'company:c9':['g2']};
const comments=[{id:'k1',rt:'deal',rid:'d3',by:'mg',at:at(18,9,10),text:'@Dev Sales can we hold 6% only if they sign before 31 Oct?'},{id:'k2',rt:'deal',rid:'d3',by:'s1',at:at(18,11,0),text:'Yes, it is in the revised quote.'}];
const templates=[{id:'e1',name:'Website enquiry acknowledgement',body:'Hi {first_name}, thanks for contacting Figbloom Digital Group about {service}. {owner_first_name} will call you within one working day.',scope:'Team',by:'mg',sys:true},{id:'e2',name:'Proposal follow-up',body:'Hi {first_name}, just checking you received our proposal for {service}. Happy to walk you through it this week. {owner_first_name}',scope:'Team',by:'s1'},{id:'e3',name:'Meeting recap',body:'Hi {first_name}, thanks for your time today. As agreed, next step: {next_action}.',scope:'Private',by:'s2'}];
const customFields=[{id:'x1',rt:'Lead',label:'Units managed',type:'Number',req:false,service:'Property Management',vis:'All roles'},{id:'x2',rt:'Lead',label:'Cameras needed',type:'Number',req:false,service:'CCTV',vis:'All roles'},{id:'x3',rt:'Company',label:'KRA PIN',type:'Text',req:false,service:'Any',vis:'Management, Finance'},{id:'x4',rt:'Deal',label:'Install date',type:'Date',req:false,service:'CCTV',vis:'All roles'},{id:'x5',rt:'Contact',label:'Preferred channel',type:'Dropdown',req:false,service:'Any',vis:'All roles'}];
const catalogue=[{id:'cat1',name:'CCTV camera (4MP dome), installed',unit:'camera',price:18500,cost:11000},{id:'cat2',name:'NVR 16-channel recorder',unit:'unit',price:65000,cost:42000},{id:'cat3',name:'Starlink kit and installation',unit:'site',price:95000,cost:72000},{id:'cat4',name:'Website design and build',unit:'project',price:180000,cost:90000},{id:'cat5',name:'Social media management',unit:'month',price:45000,cost:22000},{id:'cat6',name:'Support retainer',unit:'month',price:25000,cost:9000}];
const quotes=[{id:'q1',dealId:'d3',no:'Q-2026-031',v:2,status:'Pending approval',lines:[{cat:'cat1',qty:40},{cat:'cat2',qty:5}],discount:6,valid:at(31,9,0),terms:'50% deposit, balance on commissioning. Prices include 16% VAT.',history:[{v:1,at:at(8,10,0),by:'s1',note:'Sent by email · viewed 9 Oct'},{v:2,at:at(18,11,30),by:'s1',note:'6% discount · waiting for Management'}]}];
const approvals=[{id:'ap1',kind:'Discount',target:'Sarova Hotels · Q-2026-031 v2',detail:'6% discount. Rule: above 5% needs Management.',by:'s1',at:at(18,11,30),status:'Pending',link:['quote','d3']},{id:'ap2',kind:'Export',target:'Leads · 1,240 rows',detail:'Rule: exports above 500 rows need approval.',by:'s2',at:at(19,9,5),status:'Pending',link:['leads']},{id:'ap3',kind:'Deletion',target:'Contact · Peter Ochieng',detail:'Data-protection deletion request.',by:'mg',at:at(9,10,0),status:'Approved',link:['contacts']}];
const targets={s1:1500000,s2:1200000,mg:500000};
const cadences=[{id:'cd1',name:'Website lead',steps:['Day 0 · WhatsApp intro (prepared for you)','Day 2 · Call task','Day 5 · Email: services overview','Day 10 · Check-in task'],active:4,on:true},{id:'cd2',name:'Referral',steps:['Day 0 · Call task','Day 1 · Email: thank you and deck','Day 7 · Meeting task'],active:1,on:true}];
const enrolled={'lead:l6':{cad:'cd1',step:1},'lead:l3':{cad:'cd2',step:2}};
const orgs=[{id:'o1',name:'Figbloom Digital Group',role:'Management'},{id:'o2',name:'Figbloom Sandbox',role:'Management',sandbox:true}];
const tickets=[{id:'tk1',companyId:'c1',title:'Payroll export misses the overtime column',status:'Open',ownerId:'dl'},{id:'tk2',companyId:'c9',title:'Parent portal reset emails arrive late',status:'Waiting on customer',ownerId:'tc'}];
const surveys=[{companyId:'c9',score:9,at:at(20,9,0,8),comment:'Smooth launch and quick support.'}];

const D2=864e5;
const PLAT={
 porgs:[
  {id:'o1',name:'FigBloom Digital Group',slug:'figbloom',status:'Active',members:7,last:at(19,15,10),created:at(3,9,0,8),tz:'Africa/Nairobi',cur:'KES',owner:'Dev Management · management@figbloom.co.ke',adoption:'High',roles:[['Management',1],['Sales',2],['Delivery',1],['Finance',1],['Restricted Technical',1],['Customer Support (proposed)',1]],people:[['Dev Management','management@figbloom.co.ke','Management'],['Dev Sales','sales@figbloom.co.ke','Sales'],['Dev Sales Two','sales2@figbloom.co.ke','Sales'],['Dev Delivery','delivery@figbloom.co.ke','Delivery'],['Dev Finance','finance@figbloom.co.ke','Finance'],['Dev Restricted Technical','tech@figbloom.co.ke','Restricted Technical'],['Dev Customer Support','support@figbloom.co.ke','Customer Support (proposed)']],web:{last:'5 h ago',ok:42,bad:3},mail:'Today 07:12',usage:{views:'3,410',users:'5 of 7',volume:'38 MB'},flags:{assistant:true,integrations:true,importLimit:5000,seats:15}},
  {id:'o2',name:'Figbloom Sandbox',slug:'sandbox',status:'Active',members:2,last:at(17,11,0),created:at(20,9,0,8),tz:'Africa/Nairobi',cur:'KES',owner:'Dev Management · management@figbloom.co.ke',adoption:'Low',roles:[['Management',1],['Sales',1]],people:[['Dev Management','management@figbloom.co.ke','Management'],['Dev Sales','sales@figbloom.co.ke','Sales']],web:{last:'never',ok:0,bad:0},mail:'Not connected',usage:{views:'212',users:'1 of 2',volume:'2 MB'},flags:{assistant:false,integrations:false,importLimit:1000,seats:5},sandbox:true},
  {id:'o3',name:'Pilot · Westlands Clinics',slug:'westlands-pilot',status:'Offboarding',members:3,last:at(2,10,0),created:at(1,9,0,7),tz:'Africa/Nairobi',cur:'KES',owner:'Amina Yusuf · amina@westlandsclinics.co.ke',adoption:'Medium',roles:[['Management',1],['Sales',2]],people:[['Amina Yusuf','amina@westlandsclinics.co.ke','Management'],['Kevin Otieno','kevin@westlandsclinics.co.ke','Sales'],['Ruth Njeri','ruth@westlandsclinics.co.ke','Sales']],web:{last:'16 days ago',ok:8,bad:0},mail:'Not connected',usage:{views:'640',users:'0 of 3',volume:'5 MB'},flags:{assistant:true,integrations:true,importLimit:1000,seats:5}},
 ],
 dataRequests:[
  {id:'dr1',org:'o3',type:'Tenant offboarding',subject:'Whole organisation',requester:'Amina Yusuf (Management)',status:'In review',received:at(12,9,0),due:at(11,17,0,10),notes:'Pilot ended. Export sent 13 Oct; deletion after 30-day retention.',steps:[['Confirm requester is the organisation admin',true],['Export all data and share download link (expires in 7 days)',true],['Suspend sign-in',true],['30-day retention period',false],['Delete organisation data (needs a second platform admin)',false],['Issue completion certificate',false]],approvals:['pa'],kind:'offboard'},
  {id:'dr2',org:'o1',type:'Data deletion',subject:'Peter Ochieng (contact)',requester:'Dev Management (Management)',status:'Approved',received:at(9,10,0),due:at(9,17,0,10),notes:'Data-subject request by email. Identity checked by Management.',steps:[['Confirm the request with the organisation',true],['Find every record about the person',true],['Second platform admin approves deletion',true],['Delete and keep an anonymised audit entry',false],['Send completion certificate to the organisation',false]],approvals:['pa','pg'],kind:'delete'},
  {id:'dr3',org:'o1',type:'Data export',subject:'Leads and deals (CSV)',requester:'Dev Management (Management)',status:'Completed',received:at(2,9,0),due:at(9,17,0),notes:'Quarterly backup copy for the board.',steps:[['Prepare export',true],['Share download link (expired 9 Oct)',true]],approvals:['pa'],kind:'export'},
 ],
 support:[
  {id:'ss2',org:'o1',by:'pa',reason:'Website leads rejected since 08:00. Check website integration settings.',ticket:'FIG-812',scope:'Settings and health (read-only)',mins:60,mask:true,status:'Pending organisation approval',at:at(19,14,50),expires:at(19,16,50)},
  {id:'ss1',org:'o1',by:'pg',reason:'Help configure the onboarding template.',ticket:'FIG-770',scope:'Settings and health (read-only)',mins:30,mask:true,status:'Ended',at:at(8,11,0),ended:at(8,11,26),endedBy:'Dev Management',pages:['Settings › Onboarding template','Settings › Reference data']},
 ],
 padmins:[
  {id:'pa',name:'Dev Super Admin',email:'superadmin@platform.figbloom.co.ke',tfa:'On (dev: skipped)',last:'Today 15:02',by:'Setup script'},
  {id:'pg',name:'Given',email:'given@platform.figbloom.co.ke',tfa:'On',last:'Yesterday 18:40',by:'Setup script'},
  {id:'pm',name:'Michael',email:'michael@platform.figbloom.co.ke',tfa:'On',last:'12 Oct 09:15',by:'Given'},
 ],
 health:[
  {k:'web',l:'Website lead endpoint',status:'Degraded',d:'3 rejected submissions from figbloom.co.ke in 24 h (invalid key after rotation).',hint:'Ask FigBloom Digital Group to update the key on their website, or request support access to check.',tl:[1,1,1,1,1,1,2,2]},
  {k:'jobs',l:'Scheduled jobs · notification sweep',status:'Healthy',d:'Runs every 15 minutes. Last run 15:00, 1.2 s.',hint:'',tl:[1,1,1,1,1,1,1,1]},
  {k:'mail',l:'Email delivery',status:'Healthy',d:'412 sent in 24 h, 0 bounced.',hint:'',tl:[1,1,1,1,1,1,1,1]},
  {k:'auth',l:'Sign-in and rate limits',status:'Healthy',d:'5 failed sign-ins blocked in 24 h; 1 lockout.',hint:'',tl:[1,1,1,2,1,1,1,1]},
  {k:'err',l:'Application errors',status:'Healthy',d:'Error rate 0.08 %. 2 new issues in error tracking.',hint:'',tl:[1,1,1,1,1,1,1,1]},
  {k:'db',l:'Database and backups',status:'Healthy',d:'Last backup today 02:00 (verified). Point-in-time recovery 7 days.',hint:'',tl:[1,1,1,1,1,1,1,1]},
  {k:'ver',l:'App version and migrations',status:'Healthy',d:'v1.1.3 · migration 0042 applied 17 Oct.',hint:'',tl:[1,1,1,1,1,1,1,1]},
 ],
 announcements:[{id:'an1',title:'Planned maintenance Saturday 24 Oct, 22:00–23:00',body:'Figbloom CRM may be unavailable for up to an hour. Nothing you saved will be lost.',orgs:['o1','o2'],kind:'Maintenance',start:at(21,9,0),end:at(24,23,0),status:'Scheduled'}],
 flagHistory:[['19 Oct 10:12','Given','Figbloom Sandbox','Assistant','On → Off'],['12 Oct 09:30','Michael','FigBloom Digital Group','Import size limit','2,000 → 5,000']],
 paudit:[],
};
PLAT.paudit=[
 {at:at(19,15,2),by:'pa',org:'—',action:'Signed in',target:'Platform console',detail:'Dev chip · verification skipped',ip:'127.0.0.1',device:'Chrome · Windows'},
 {at:at(19,14,50),by:'pa',org:'FigBloom Digital Group',action:'Support access requested',target:'Settings and health (read-only)',detail:'FIG-812 · 60 min',ip:'41.90.64.12',device:'Chrome · Windows'},
 {at:at(13,10,5),by:'pg',org:'Pilot · Westlands Clinics',action:'Organisation export created',target:'Full export',detail:'Link expires 20 Oct',ip:'41.90.64.20',device:'Safari · macOS'},
 {at:at(12,9,30),by:'pg',org:'Pilot · Westlands Clinics',action:'Offboarding started',target:'Organisation',detail:'Requested by Amina Yusuf',ip:'41.90.64.20',device:'Safari · macOS'},
 {at:at(8,11,26),by:'pg',org:'FigBloom Digital Group',action:'Support view ended',target:'2 pages viewed',detail:'Ended by Dev Management',ip:'41.90.64.20',device:'Safari · macOS'},
 {at:at(12,9,30,10),by:'pm',org:'FigBloom Digital Group',action:'Flag changed',target:'Import size limit',detail:'2,000 → 5,000',ip:'105.163.2.8',device:'Chrome · Android'},
];

const THEMES={forest:['Forest','#203E2A','#275B3A','#FF9400'],ocean:['Ocean','#14365C','#1F5FA3','#FFB020'],midnight:['Midnight','#151A2E','#4A5BD6','#FF8A3D'],aubergine:['Aubergine','#3A1F3D','#7A3E7F','#FFB347'],teal:['Teal','#0F3B3E','#16777A','#FFC145'],rosewood:['Rosewood','#4A1F24','#9C3B45','#FFB36B'],charcoal:['Charcoal and amber','#232323','#4D4D4D','#FFB000'],mist:['Mist','#3E4A52','#4F6B7A','#FF9F45'],sand:['Sand','#5A4632','#8A6A3F','#E8862A'],sky:['Sky','#1C4E6E','#2B7DB3','#FFA62B']};
const PAGES={white:['White','#FFFFFF','#FAF9F7',0],cool:['Cool grey','#FFFFFF','#F3F5F7',0],sand:['Warm sand','#FFFFFF','#F6F1E8',0],mint:['Mint','#FFFFFF','#EFF6F1',0],sky:['Sky','#FFFFFF','#EEF4FA',0],lavender:['Lavender','#FFFFFF','#F3F1FA',0],blush:['Blush','#FFFFFF','#FAF1F1',0],dark:['Dark','#161E19','#0F1512',1],navy:['Navy night','#141B2D','#0C1220',1],black:['Black','#121212','#000000',1],device:['Match my device','','',2]};
const hexL=h=>{h=h.replace('#','');const c=[0,2,4].map(i=>parseInt(h.substr(i,2),16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const contrast=(a,b)=>{const x=hexL(a),y=hexL(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const darken=(h,f)=>'#'+[0,2,4].map(i=>Math.round(parseInt(h.replace('#','').substr(i,2),16)*f).toString(16).padStart(2,'0')).join('');
let saved={}; try{saved=JSON.parse(localStorage.getItem('fbcrm-ui')||'{}')}catch(e){}
const S={
 authed:!!saved.authed, userId:saved.userId||'mg', route:saved.route||{page:'login'}, theme:saved.theme||'light', device:saved.device||'desktop', sim:'normal',
 collapsed:false, drawer:null, modal:null, menu:null, toasts:[], review:true, dark:false,
 leads, deals, tasks, companies, contacts, activities, audit, notifications, members, payments, submissions, inbox, recurring,
 lastVisit:at(18,17,40), qs:'', release:saved.release||'v2',
 attachments, tagDefs, tagMap, comments, follows:{'deal:d3':['mg']}, templates, customFields, catalogue, quotes, approvals, targets, cadences, enrolled, orgs, tickets, surveys,
 ...PLAT, prefs:{theme:'forest',page:'white',lightPage:'white',darkPage:'dark',density:'comfortable',text:'default',bold:false,contrast:false,motion:false,focus:false,start:'dashboard',sideStart:'expanded',labels:true,clock:'12',week:'Mon',dateFmt:'19 Oct 2026',tz:'Africa/Nairobi',custom:null,avatar:null,notif:{},preset:'important',quiet:true,cap:20,...((saved.prefs)||{})}, curOrg:null, homeUser:null, orgPersonalise:true, orgDefaultTheme:'forest', orgLogo:null, multiOrg:false, signedInAt:new Date(2026,9,19,11,23,14), sessionHours:12, expiring:false,
 memberships:[{id:'o1',name:'FigBloom Digital Group',role:'Your current role',last:'Now',unread:0},{id:'b2',name:'Brookside Ltd',role:'Sales',last:'2 days ago',unread:3},{id:'b3',name:'Kilimani Property Group',role:'Management',last:'Last week',unread:0},{id:'b4',name:'Westlands Clinics',role:'Sales',last:'—',unread:0,suspended:'Suspended by Figbloom on 14 Oct'},{id:'b5',name:'Nyeri Coffee Co-op',role:'Delivery',invite:true}], orgSuspended:false, supportActive:null, announceDismissed:false, devSkip:true,
 palette:false, assistant:null, help:false, offlineQ:3, pipeline:'Digital services', gates:{proposal:true}, leaderboard:false, ai:true, firstRun:{import:false,invite:true,website:false,mobile:false}, firstRunHidden:false,
};
const subs=new Set();
let tid=1;
const persist=()=>{try{localStorage.setItem('fbcrm-ui',JSON.stringify({authed:S.authed,userId:S.userId,route:S.route,theme:S.theme,device:S.device,release:S.release,prefs:S.prefs}))}catch(e){}};
const emit=()=>{persist();subs.forEach(f=>{try{f()}catch(e){console.error(e)}})};
const fmtN=n=>Math.round(n).toLocaleString('en-US');
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const sameDay=(a,b)=>a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
const time=d=>{let h=d.getHours(),m=d.getMinutes();const ap=h>=12?'PM':'AM';h=h%12||12;return h+':'+String(m).padStart(2,'0')+' '+ap};

const PERM={
 management:['leads','leads.all','leads.assign','leads.import','leads.export','deals','deals.all','deals.edit','deals.values','deals.export','deals.open','tasks','tasks.all','tasks.assignAny','calendar','calendar.team','customers','customers.edit','customers.merge','customers.import','customers.export','customers.reassign','customers.payments','reports.org','payments','delivery','settings.org','members','audit','handoff.start','activities.create','comms','comms.create','retention','deals.margin'],
 sales:['leads','deals','deals.edit','deals.open','tasks','calendar','customers','customers.edit','customers.merge','reports.personal','handoff.start','activities.create','comms','comms.create','retention'],
 delivery:['deals','tasks','customers','reports.personal','delivery','activities.create','comms','comms.create'],
 finance:['deals','deals.values','customers','customers.payments','reports.personal','payments','payments.manage'],
 technical:['tasks','work','comms'],
 support:['customers','comms','tasks','reports.personal'],
};
const PAGE_PERM={dashboard:null,leads:'leads',lead:'leads',deals:'deals',deal:'deals',tasks:'tasks',calendar:'calendar',companies:'customers',company:'customers',contacts:'customers',contact:'customers',reports:'reports',finance:'payments',delivery:'delivery',work:'work',notifications:null,search:null,settings:null,audit:'audit',conversations:'comms',retention:'retention',quote:'quotes.create',approvals:'quotes.approve',forecast:'reports'};
const PAGE_OWNER={leads:'Management and Sales',deals:'Management, Sales, Delivery and Finance',tasks:'Management, Sales, Delivery and Restricted Technical',calendar:'Management and Sales',customers:'Management, Sales, Delivery and Finance',reports:'every role except Restricted Technical',payments:'Finance and Management',delivery:'Delivery and Management',work:'Restricted Technical members',audit:'Management',comms:'Management, Sales, Delivery and Restricted Technical (read-only)',retention:'Management and Sales','quotes.create':'Management and Sales','quotes.approve':'Management'};
const PAGE_NAME={leads:'Leads',lead:'Leads',deals:'Deals',deal:'Deals',tasks:'Tasks',calendar:'Calendar',companies:'Companies',company:'Companies',contacts:'Contacts',contact:'Contacts',reports:'Reports',finance:'Payments',delivery:'Handoffs',work:'My work',audit:'Audit log',conversations:'Conversations',retention:'Renewals & retention',quote:'Quote builder',approvals:'Approvals',forecast:'Forecast & targets'};

const FB={
 s:S, now:NOW, ref, users, ROLES, MON,
 sub(f){subs.add(f);return()=>subs.delete(f)},
 set(p){Object.assign(S,typeof p==='function'?p(S):p);emit()},
 emit,
 // identity
 me(){return users.find(u=>u.id===S.userId)},
 role(){return FB.me().role},
 roleLabel(r){return ROLES[r||FB.role()]},
 can(p){if(p==='reports')return FB.can('reports.org')||FB.can('reports.personal');return PERM[FB.role()].includes(p)},
 user(id){return users.find(u=>u.id===id)},
 uname(id){const u=FB.user(id);return u?u.name:'Unassigned'},
 initials(name){if(!name)return '?';const p=name.replace(/[^A-Za-z ]/g,'').split(' ').filter(Boolean);if(!p.length)return '?';return (p.length>1?p[0][0]+p[1][0]:p[0].slice(0,2)).toUpperCase()},
 pageAllowed(pg){const k=PAGE_PERM[pg];return !k||FB.can(k)},
 pageOwner(pg){return PAGE_OWNER[PAGE_PERM[pg]]||'other roles'},
 pageName(pg){return PAGE_NAME[pg]||pg},
 isMine(rec){return rec&&rec.ownerId===S.userId},
 // nav
 go(page,id,extra){S.route=Object.assign({page,id:id||null},extra||{});S.menu=null;S.drawer=null;S.modal=null;emit();const m=document.getElementById('fb-main');if(m)m.scrollTo(0,0);const mm=document.getElementById('fb-mmain');if(mm)mm.scrollTo(0,0)},
 openLink(type,id){({lead:()=>FB.go('lead',id),deal:()=>FB.go('deal',id),company:()=>FB.go('company',id),contact:()=>FB.go('contact',id),task:()=>FB.go('tasks'),finance:()=>FB.go('finance'),conversations:()=>FB.go('conversations')}[type]||(()=>{}))()},
 drawer(type,data){S.drawer={type,data:data||{}};S.menu=null;emit()},
 modal(type,data){S.modal={type,data:data||{}};S.menu=null;emit()},
 close(){S.drawer=null;S.modal=null;S.menu=null;emit()},
 toast(text,undo,kind){const id=tid++;S.toasts=[...S.toasts,{id,text,undo,kind:kind||'ok'}];emit();setTimeout(()=>{S.toasts=S.toasts.filter(t=>t.id!==id);emit()},5200)},
 dismissToast(id){S.toasts=S.toasts.filter(t=>t.id!==id);emit()},
 // format
 kes(n){return 'KES '+fmtN(n)},
 num:fmtN,
 kesShort(n){return n>=1e6?'KES '+(n/1e6).toFixed(n%1e6?2:0).replace(/0$/,'')+'M':n>=1e3?'KES '+Math.round(n/1e3)+'k':'KES '+n},
 date(d){return d?d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear():'—'},
 dshort(d){return d?d.getDate()+' '+MON[d.getMonth()]:'—'},
 time,
 when(d){if(!d)return '—';if(sameDay(d,NOW))return 'Today, '+time(d);if(sameDay(d,new Date(NOW.getTime()+DAY)))return 'Tomorrow, '+time(d);if(sameDay(d,new Date(NOW.getTime()-DAY)))return 'Yesterday, '+time(d);return FB.dshort(d)+', '+time(d)},
 ago(d){const s=(NOW-d)/1000;if(s<3600)return Math.max(1,Math.round(s/60))+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';const dd=Math.round(s/86400);return dd===1?'yesterday':dd+' days ago'},
 daysSince(d){return Math.floor((NOW-d)/DAY)},
 sameDay,
 dueState(d,done){if(done)return 'done';if(!d)return 'none';if(d<NOW)return 'overdue';if(sameDay(d,NOW))return 'today';return 'upcoming'},
 dueLabel(d,done){const st=FB.dueState(d,done);if(st==='none')return 'No date';if(st==='overdue')return 'Overdue · '+FB.dshort(d)+', '+time(d);if(st==='today')return 'Today · '+time(d);return FB.when(d)},
 // lookups
 company(id){return S.companies.find(c=>c.id===id)},
 contact(id){return S.contacts.find(c=>c.id===id)},
 lead(id){return S.leads.find(c=>c.id===id)},
 deal(id){return S.deals.find(c=>c.id===id)},
 task(id){return S.tasks.find(c=>c.id===id)},
 cname(p){return p?(p.first+' '+p.last).trim():''},
 linkLabel(l){if(!l)return '';if(l.type==='lead'){const x=FB.lead(l.id);return 'Lead · '+(x?x.name:'')}if(l.type==='deal'){const x=FB.deal(l.id);return 'Deal · '+(x?FB.company(x.companyId).name:'')}if(l.type==='company'){const x=FB.company(l.id);return 'Customer · '+(x?x.name:'')}return ''},
 linkAllowed(l){if(!l)return false;if(l.type==='lead')return FB.can('leads');if(l.type==='deal')return FB.can('deals')&&!!FB.dealsVisible().find(d=>d.id===l.id);if(l.type==='company')return FB.can('customers');return true},
 // scoped data
 leadsVisible(){const r=FB.role();if(r==='management')return S.leads;if(r==='sales')return S.leads.filter(l=>l.ownerId===S.userId);return []},
 poolLeads(){return S.leads.filter(l=>!l.ownerId&&!l.archived)},
 dealsVisible(){const r=FB.role();if(r==='management')return S.deals;if(r==='sales')return S.deals.filter(d=>d.ownerId===S.userId);if(r==='delivery'||r==='finance')return S.deals.filter(d=>d.stage==='Closed Won');return []},
 tasksVisible(){return FB.role()==='management'?S.tasks:S.tasks.filter(t=>t.assigneeId===S.userId)},
 valueVisible(d){return FB.can('deals.values')||(FB.role()==='sales'&&d.ownerId===S.userId)},
 dealValue(d){return FB.valueVisible(d)?FB.kes(d.value):'Values hidden'},
 stalled(d){return !d.stage.startsWith('Closed')&&FB.daysSince(d.lastActivity)>=10},
 canEditDeal(d){return FB.can('deals.edit')&&(FB.can('deals.all')||d.ownerId===S.userId)&&!d.archived},
 canEditLead(l){return FB.can('leads')&&(FB.can('leads.all')||l.ownerId===S.userId)&&!l.archived},
 activitiesFor(rt,rid){return S.activities.filter(a=>a.rt===rt&&a.rid===rid).sort((a,b)=>b.at-a.at)},
 notifsMine(){return S.notifications.filter(n=>n.to.includes(S.userId)||(n.to.includes('mg')&&FB.role()==='management'&&S.userId==='mg')).sort((a,b)=>b.at-a.at)},
 commCompanyId(rt,rid){if(rt==='company')return rid;if(rt==='lead'){const l=FB.lead(rid);return l&&l.companyId}if(rt==='deal'){const d=FB.deal(rid);return d&&d.companyId}return null},
 commAllowed(rt,rid){const r=FB.role();if(!FB.can('comms'))return false;if(r==='management')return true;if(r==='sales'){if(rt==='lead'){const l=FB.lead(rid);return l&&l.ownerId===S.userId}if(rt==='deal'){const d=FB.deal(rid);return d&&d.ownerId===S.userId}const c=FB.company(rid);return c&&(c.ownerId===S.userId||S.deals.some(d=>d.companyId===rid&&d.ownerId===S.userId))}const cid=FB.commCompanyId(rt,rid);if(r==='delivery')return !!cid&&S.deals.some(d=>d.companyId===cid&&d.stage==='Closed Won');if(r==='technical')return !!cid&&S.tasks.some(t=>t.assigneeId===S.userId&&t.link&&t.link.type==='company'&&t.link.id===cid);return false},
 commsVisible(){const K=['call','whatsapp','email','meeting','social'];return S.activities.filter(a=>K.includes(a.kind)&&FB.commAllowed(a.rt,a.rid)).sort((a,b)=>b.at-a.at)},
 linkInbox(id,type,rid){const m=S.inbox.find(x=>x.id===id);if(!m)return;m.link={type,id:rid};FB.log(type,rid,m.channel==='social'?'social':'email',m.subject+': '+m.summary,{dir:'in'});FB.toast('Linked to '+FB.linkLabel({type,id:rid}).replace(/^\w+ · /,''));emit()},
 inboxToLead(id){const m=S.inbox.find(x=>x.id===id);const lid='l'+Date.now();S.leads=[{id:lid,companyId:null,contactId:null,name:m.name.split(' · ').pop(),status:'New',temp:'Warm',source:m.channel==='social'?'Facebook':'Email',service:/cctv/i.test(m.subject)?'CCTV':/starlink/i.test(m.subject)?'Starlink / Internet':'Consulting / Other',ownerId:FB.role()==='management'?null:S.userId,next:new Date(NOW.getTime()+864e5),createdAt:new Date(NOW),qual:{},notes:m.summary},...S.leads];m.link={type:'lead',id:lid};FB.log('lead',lid,m.channel==='social'?'social':'email',m.subject+': '+m.summary,{dir:'in'});FB.toast('Lead created from '+(m.channel==='social'?'message':'email'));emit()},
 unread(){return FB.notifsMine().filter(n=>!n.read).length},
 // mutations
 log(rt,rid,kind,text,extra){S.activities=[A(rt,rid,kind,S.userId,new Date(NOW.getTime()+(aid%50)*1000),text,extra),...S.activities]},
 auditAdd(action,target,detail){S.audit=[{at:new Date(),byId:S.userId,action,target,detail},...S.audit]},
 signIn(uid,o){S.userId=uid;S.authed=true;const u=users.find(x=>x.id===uid);S.devSkip=!(o&&o.verified);S.route={page:u&&u.role==='platform'?'p-home':(S.prefs&&S.prefs.start&&FB.rel('v11')?S.prefs.start:'dashboard')};S.signedInAt=new Date(NOW.getTime()-3*36e5-49*6e4);if(S.prefs&&S.prefs.sideStart)S.collapsed=S.prefs.sideStart==='collapsed';S.menu=null;emit()},
 isPlatform(){const u=FB.me();return !!(u&&u.role==='platform')},
 plog(action,org,target,detail){S.paudit.unshift({at:new Date(NOW),by:S.userId,org:org||'—',action,target:target||'—',detail:detail||'',ip:'41.90.64.12',device:'Chrome · Windows'});},
 signOut(){S.authed=false;S.route={page:'login'};S.menu=null;emit()},
 saveLead(data){
  if(data.id){const l=FB.lead(data.id);Object.assign(l,data);FB.log('lead',l.id,'note','Lead details updated');FB.toast('Lead updated')}
  else{const id='l'+Date.now();const l={id,status:'New',temp:'Warm',source:'Phone',service:'Web Development',ownerId:FB.role()==='management'?(data.ownerId||null):S.userId,next:null,createdAt:new Date(NOW.getTime()+60000),qual:{},...data,id};
   if(!l.companyId&&data.companyName){l.name=data.companyName}else if(l.companyId){l.name=FB.company(l.companyId).name}
   if(!l.name)l.name=data.contactName||'New lead';
   S.leads=[l,...S.leads];FB.log('lead',id,'system','Lead created');FB.auditAdd('Lead created',l.name,'Source '+l.source);FB.toast('Lead created: '+l.name,()=>{S.leads=S.leads.filter(x=>x.id!==id);emit()});}
  S.drawer=null;emit()},
 setLeadStatus(id,st){const l=FB.lead(id);const old=l.status;l.status=st;FB.log('lead',id,'status','Status changed from '+old+' to '+st);FB.toast('Status set to '+st,()=>{l.status=old;emit()});emit()},
 reassignLead(id,uid){const l=FB.lead(id);const old=l.ownerId;l.ownerId=uid||null;FB.log('lead',id,'assigned','Reassigned from '+FB.uname(old)+' to '+FB.uname(uid));FB.auditAdd('Lead reassigned',l.name,FB.uname(old)+' → '+FB.uname(uid));FB.toast(l.name+' reassigned to '+FB.uname(uid),()=>{l.ownerId=old;emit()});emit()},
 convertLead(id,o){const l=FB.lead(id);if(l.status==='Converted'){FB.toast('Already converted. Opening the deal.');return FB.go('deal',l.dealId)}
  let cid=l.companyId;if(!cid){cid='c'+Date.now();S.companies=[{id:cid,name:o.companyName||l.name,industry:'',lifecycle:'Prospect',ownerId:l.ownerId||S.userId,phone:'',email:'',website:'',location:'',createdAt:new Date(),services:[],issues:[]},...S.companies]}
  const did='d'+Date.now();S.deals=[{id:did,companyId:cid,contactId:l.contactId,title:o.title||l.service,service:l.service,stage:'Solution Presented',value:+o.value||0,ownerId:l.ownerId||S.userId,close:o.close||new Date(NOW.getTime()+30*DAY),source:l.source,lastActivity:new Date(NOW),createdAt:new Date(NOW),proposals:[]},...S.deals];
  l.status='Converted';l.dealId=did;l.companyId=cid;
  S.activities.filter(a=>a.rt==='lead'&&a.rid===id).forEach(a=>S.activities.push({...a,id:'a'+(aid++),rt:'deal',rid:did,carried:true}));
  FB.log('deal',did,'system','Created from lead '+l.name+'. History carried over.');FB.log('lead',id,'status','Converted to a deal');FB.auditAdd('Lead converted',l.name,'Deal created in Solution Presented');
  S.modal=null;FB.toast('Converted. '+l.name+' is now a deal in Solution Presented');FB.go('deal',did)},
 markLost(kind,id,reason,note){if(kind==='lead'){const l=FB.lead(id);const old=l.status;l.status='Lost';l.lostReason=reason;FB.log('lead',id,'status','Marked lost: '+reason+(note?' · '+note:''));FB.toast(l.name+' marked lost',()=>{l.status=old;emit()})}else{const d=FB.deal(id);const old=d.stage;d.stage='Closed Lost';d.lostReason=reason;d.lastActivity=new Date(NOW);FB.log('deal',id,'stage','Stage moved from '+old+' to Closed Lost · '+reason);FB.toast(FB.company(d.companyId).name+' moved to Closed Lost',()=>{d.stage=old;emit()})}S.modal=null;emit()},
 moveDeal(id,stage){const d=FB.deal(id);if(!d||d.stage===stage)return;if(stage==='Closed Lost')return FB.modal('lost',{kind:'deal',id});if(stage==='Closed Won')return FB.modal('handoff',{id});const old=d.stage;d.stage=stage;d.lastActivity=new Date(NOW);FB.log('deal',id,'stage','Stage moved from '+old+' to '+stage);FB.toast(FB.company(d.companyId).name+' moved to '+stage,()=>{d.stage=old;emit()});emit()},
 confirmWon(id,o){const d=FB.deal(id);const old=d.stage;d.stage='Closed Won';d.wonAt=new Date(NOW);d.lastActivity=new Date(NOW);const c=FB.company(d.companyId);
  d.handoff={ownerId:o.ownerId||null,start:o.start||new Date(NOW.getTime()+2*DAY),status:o.ownerId?'Onboarding':'Awaiting owner',team:o.ownerId?[o.ownerId]:[],scope:o.scope||d.title,requirements:[],deliverables:[],notes:o.notes||''};
  if(o.lifecycle){c.lifecycle='Onboarding'}
  if(o.template){ref.onboarding.forEach((t,i)=>S.tasks.push({id:'t'+Date.now()+i,title:t+' · '+c.name,assigneeId:o.ownerId||'dl',due:new Date(NOW.getTime()+(i+1)*DAY),priority:i===0?'High':'Medium',status:'Pending',link:{type:'company',id:c.id},onboarding:true}))}
  FB.log('deal',id,'stage','Stage moved from '+old+' to Closed Won');FB.log('deal',id,'handoff','Handed off to Delivery'+(o.ownerId?'. Owner: '+FB.uname(o.ownerId):'')+(o.template?'. Onboarding template applied (4 tasks).':''));FB.log('company',c.id,'handoff','Won: '+d.title+'. Lifecycle moved to Onboarding.');
  if(o.notify)S.notifications=[{id:'n'+Date.now(),type:'Handoff',to:['dl','mg'],text:c.name+' · '+d.title+' was won and handed to Delivery',at:new Date(NOW),read:false,link:['company',c.id]},...S.notifications];
  FB.auditAdd('Deal won and handed off',c.name+' · '+d.title,'Delivery owner '+FB.uname(o.ownerId));
  S.modal=null;FB.toast('Won! '+c.name+' handed to Delivery'+(o.notify?' and the team was notified':''));emit()},
 archive(kind,id){const rec=FB[kind](id);rec.archived=true;FB.toast((rec.name||rec.title||FB.cname(rec))+' archived',()=>{rec.archived=false;emit()});emit()},
 restore(kind,id){const rec=FB[kind](id);rec.archived=false;FB.toast('Restored');emit()},
 toggleTask(id){const t=FB.task(id);const was=t.status;t.status=was==='Completed'?'Pending':'Completed';t.doneAt=new Date(NOW);if(t.status==='Completed')FB.toast('Task done: '+t.title,()=>{t.status=was;emit()});emit()},
 setTaskStatus(id,st){FB.task(id).status=st;emit()},
 saveTask(o){if(o.id){Object.assign(FB.task(o.id),o);FB.toast('Task updated')}else{const t={id:'t'+Date.now(),status:'Pending',priority:'Medium',assigneeId:S.userId,...o};S.tasks=[t,...S.tasks];FB.toast('Task created',()=>{S.tasks=S.tasks.filter(x=>x.id!==t.id);emit()})}S.drawer=null;emit()},
 logComm(rt,rid,kind,text,outcome,next){FB.log(rt,rid,kind,text||({call:'Call logged',whatsapp:'WhatsApp conversation logged',email:'Email logged',note:'Note added',meeting:'Meeting logged'}[kind]),{outcome});if(rt==='deal'){FB.deal(rid).lastActivity=new Date(NOW)}
  if(next&&next.title){S.tasks=[{id:'t'+Date.now(),title:next.title,assigneeId:S.userId,due:next.due,priority:'Medium',status:'Pending',link:{type:rt,id:rid}},...S.tasks]}
  S.drawer=null;S.modal=null;FB.toast(next&&next.title?'Logged. Next action: '+next.title:'Logged to the timeline');emit()},
 saveContact(o){const p={id:'p'+Date.now(),ownerId:S.userId,title:'',...o};S.contacts=[p,...S.contacts];S.drawer=null;FB.toast('Contact added: '+FB.cname(p));emit()},
 saveCompany(o){const c={id:'c'+Date.now(),ownerId:S.userId,lifecycle:'Prospect',createdAt:new Date(),services:[],issues:[],...o};S.companies=[c,...S.companies];S.drawer=null;FB.toast('Company added: '+c.name);emit();return c},
 saveDeal(o){const d={id:'d'+Date.now(),stage:'Solution Presented',ownerId:S.userId,lastActivity:new Date(NOW),createdAt:new Date(NOW),proposals:[],close:new Date(NOW.getTime()+30*DAY),source:'Direct Outreach',...o};S.deals=[d,...S.deals];S.drawer=null;FB.toast('Deal created');emit()},
 reassign(kind,id,uid){const r=FB[kind](id);const old=r.ownerId;r.ownerId=uid||null;FB.toast((r.name||FB.cname(r)||r.title)+' now owned by '+FB.uname(uid),()=>{r.ownerId=old;emit()});emit()},
 rel(t){const o={v1:1,v11:2,v2:3};return o[S.release]>=o[t||'v1']},
 relPill(t){return {v1:{l:'V1',bg:'var(--primary-soft)',fg:'var(--primary-text)'},v11:{l:'V1.1',bg:'var(--blue-soft)',fg:'var(--blue)'},v2:{l:'V2',bg:'var(--purple-soft)',fg:'var(--purple)'}}[t||'v1']},
 tagsOf(rt,rid){return (S.tagMap[rt+':'+rid]||[]).map(id=>S.tagDefs.find(t=>t.id===id)).filter(Boolean)},
 tagTone(c){return {red:['var(--red-soft)','var(--red)'],purple:['var(--purple-soft)','var(--purple)'],blue:['var(--blue-soft)','var(--blue)'],green:['var(--primary-soft)','var(--primary-text)'],orange:['var(--orange-soft)','var(--orange-text)']}[c]||['var(--surface-3)','var(--text-2)']},
 toggleTag(rt,rid,tid){const k=rt+':'+rid;const a=S.tagMap[k]=S.tagMap[k]||[];const i=a.indexOf(tid);if(i>=0)a.splice(i,1);else a.push(tid);emit()},
 score(rt,rid){const R=[];let n=0;
  if(rt==='lead'){const l=FB.lead(rid);if(!l)return null;n={Hot:62,Warm:45,Cold:22}[l.temp]||40;const sq={Referral:12,Website:8,'Direct Outreach':5,Networking:6,Facebook:-4,TikTok:-6}[l.source]||0;if(sq)R.push({l:'Source: '+l.source,d:sq});
   if(['CCTV','Property Management','HR'].includes(l.service)){R.push({l:'High-value service',d:6});n+=6}
   const first=S.activities.filter(a=>a.rt==='lead'&&a.rid===l.id&&['call','whatsapp','email','meeting'].includes(a.kind)).sort((a,b)=>a.at-b.at)[0];const fast=first&&first.at-l.createdAt<DAY;R.push({l:fast?'Replied within a day':'No quick first reply',d:fast?8:-6});n+=fast?8:-6;
   const wins=S.deals.filter(d=>d.stage==='Closed Won'&&d.service===l.service).length;if(wins){R.push({l:wins+' similar past win'+(wins>1?'s':''),d:wins*5});n+=wins*5}n+=sq;R.unshift({l:'Temperature: '+l.temp,d:0});if(l.scoreOverride!=null)return {n:l.scoreOverride,auto:Math.max(0,Math.min(100,n)),band:l.scoreOverride>=65?'Hot':l.scoreOverride>=40?'Warm':'Cold',reasons:R,over:true}}
  else{const d=FB.deal(rid);if(!d)return null;n={'Solution Presented':35,'Proposal Sent':50,'Negotiation':72,'Closed Won':100,'Closed Lost':0}[d.stage];R.push({l:'Stage: '+d.stage,d:0});if(FB.stalled(d)){R.push({l:'Stalled '+FB.daysSince(d.lastActivity)+' days',d:-15});n-=15}if(FB.daysSince(d.lastActivity)<=3){R.push({l:'Active this week',d:10});n+=10}if(S.quotes.some(q=>q.dealId===d.id)||d.proposals.length){R.push({l:'Quote or proposal sent',d:6});n+=6}}
  n=Math.max(0,Math.min(100,Math.round(n)));return {n,band:n>=65?'Hot':n>=40?'Warm':'Cold',reasons:R,over:false}},
 quoteTotals(q){const sub=q.lines.reduce((a,x)=>{const c=S.catalogue.find(k=>k.id===x.cat);return a+(c?c.price*x.qty:0)},0);const cost=q.lines.reduce((a,x)=>{const c=S.catalogue.find(k=>k.id===x.cat);return a+(c?c.cost*x.qty:0)},0);const disc=sub*(q.discount||0)/100;const net=sub-disc;const vat=net*0.16;return {sub,disc,net,vat,total:net+vat,cost,margin:net?Math.round((net-cost)/net*100):0}},
 readNotif(id){const n=S.notifications.find(x=>x.id===id);if(n)n.read=true;emit()},
 readAll(){FB.notifsMine().forEach(n=>n.read=true);FB.toast('All caught up');emit()},
 simulate(kind){S.sim=kind;emit()},
 search(q){q=(q||'').toLowerCase().trim();if(!q)return {leads:[],deals:[],companies:[],contacts:[],tasks:[]};const m=s=>(s||'').toLowerCase().includes(q);
  return {leads:FB.can('leads')?FB.leadsVisible().filter(l=>m(l.name)||m(l.service)):[],deals:FB.can('deals')?FB.dealsVisible().filter(d=>m(FB.company(d.companyId).name)||m(d.title)):[],companies:FB.can('customers')?S.companies.filter(c=>m(c.name)||m(c.industry)):[],contacts:FB.can('customers')?S.contacts.filter(p=>m(FB.cname(p))||m(p.email)||m(p.phone)):[],tasks:FB.tasksVisible().filter(t=>m(t.title))}},
 // presentation helpers
 tempTone(t){return {Hot:['var(--red-soft)','var(--red)'],Warm:['var(--orange-soft)','var(--orange-text)'],Cold:['var(--blue-soft)','var(--blue)']}[t]||['var(--surface-3)','var(--text-2)']},
 prioTone(p){return {High:['var(--red-soft)','var(--red)'],Medium:['var(--orange-soft)','var(--orange-text)'],Low:['var(--surface-3)','var(--text-2)']}[p]},
 stageTone(s){return {'Solution Presented':'var(--blue)','Proposal Sent':'var(--orange)','Negotiation':'var(--primary)','Closed Won':'var(--primary)','Closed Lost':'var(--red)'}[s]},
 lifeTone(s){return {Prospect:['var(--surface-3)','var(--text-2)'],Customer:['var(--primary-soft)','var(--primary-text)'],Onboarding:['var(--blue-soft)','var(--blue)'],'Active Customer':['var(--primary-soft)','var(--primary-text)'],'Dormant Customer':['var(--orange-soft)','var(--orange-text)'],Renewal:['var(--purple-soft)','var(--purple)']}[s]||['var(--surface-3)','var(--text-2)']},
 statusTone(s){return {New:['var(--blue-soft)','var(--blue)'],Qualified:['var(--primary-soft)','var(--primary-text)'],Contacted:['var(--surface-3)','var(--text)'],'Needs Identified':['var(--purple-soft)','var(--purple)'],Converted:['var(--primary-soft)','var(--primary-text)'],Lost:['var(--red-soft)','var(--red)'],Unqualified:['var(--surface-3)','var(--text-3)'],Inactive:['var(--surface-3)','var(--text-3)']}[s]||['var(--surface-3)','var(--text-2)']},
 invTone(s){return {Paid:['var(--primary-soft)','var(--primary-text)'],Sent:['var(--blue-soft)','var(--blue)'],Overdue:['var(--red-soft)','var(--red)'],'Not invoiced':['var(--surface-3)','var(--text-2)']}[s]},
 actIcon(k){return {social:'message',call:'phone',whatsapp:'whatsapp',email:'mail',note:'note',meeting:'users',stage:'swap',status:'swap',system:'zap',assigned:'user',handoff:'package'}[k]||'circle'},
 scope(kind){const r=FB.role();if(r==='management')return {label:'All organisation '+kind,tone:'org',hint:''};if((r==='delivery'||r==='finance')&&kind!=='tasks')return {label:'Read-only',tone:'ro',hint:''};return {label:'My '+kind,tone:'own',hint:''}},
};
FB.scopeStyle=t=>({org:{bg:'var(--primary-soft)',fg:'var(--primary-text)',dot:'var(--primary)'},own:{bg:'var(--orange-soft)',fg:'var(--orange-text)',dot:'var(--orange)'},ro:{bg:'var(--surface-3)',fg:'var(--text-2)',dot:'var(--text-3)'}})[t];
FB.ownerOptions=()=>users.filter(u=>u.role==='sales'||u.role==='management').map(u=>({id:u.id,label:u.name+' ('+ROLES[u.role]+')'}));
PERM.platform=['platform.orgs.view','platform.orgs.provision','platform.orgs.suspend','platform.data_requests.manage','platform.data_requests.approve','platform.support.request','platform.audit.view','platform.health.view','platform.admins.manage','platform.security.manage','platform.flags.manage','platform.announcements.manage'];
const NEWP={management:['attachments.manage','templates.manage','tags.manage','customfields.manage','views.share','quotes.create','quotes.approve','catalogue.manage','forecast.view.all','targets.manage','cadences.manage','ai.use','ai.configure','api_tokens.manage','webhooks.manage','security.manage','deals.margin'],sales:['attachments.manage','views.share','quotes.create','ai.use'],delivery:['attachments.manage','ai.use'],finance:['ai.use'],technical:[],support:['attachments.manage','ai.use','tickets.manage']};
Object.keys(NEWP).forEach(r=>{PERM[r]=[...new Set([...(PERM[r]||[]),...NEWP[r]])]});
FB.NEWP=NEWP;FB.PERM=PERM;
const _mv=FB.moveDeal;FB.moveDeal=(id,st)=>{const d=FB.deal(id);if(FB.rel('v11')&&S.gates.proposal&&st==='Proposal Sent'&&d&&!S.quotes.some(q=>q.dealId===id)&&!(d.proposals||[]).length){FB.toast('Not moved: Proposal Sent needs a quote or proposal attached (stage rule). Build the quote first.');return}return _mv(id,st)};
FB.preview=(page,extra)=>{try{if(document.querySelector('[data-fb-root]')||FB._pv)return;FB._pv=true;S.authed=true;if(!S.userId||S.userId==='cs')S.userId='mg';S.device='desktop';S.route={page:page||'dashboard',...(extra&&extra.route||{})};if(extra&&extra.user)S.userId=extra.user;if(extra&&extra.set)Object.assign(S,extra.set);document.documentElement.setAttribute('data-theme',S.theme||'light');if(!(extra&&extra.bare)){document.body.style.padding='32px 40px 80px';document.body.style.maxWidth='1380px';document.body.style.margin='0 auto';}document.body.style.height='auto';document.body.style.minHeight='100vh';emit()}catch(e){console.error(e)}};
FB.toggleDark=()=>{const P=S.prefs;const cur=P.page==='device'?S.theme:(PAGES[P.page]||[])[3]===1?'dark':'light';if(cur==='dark'){P.page=PAGES[P.lightPage]&&PAGES[P.lightPage][3]!==1?P.lightPage:'white'}else{if(PAGES[P.page]&&PAGES[P.page][3]===0)P.lightPage=P.page;P.page=PAGES[P.darkPage]&&PAGES[P.darkPage][3]===1?P.darkPage:'dark'}S.menu=null;emit()};
FB.THEMES=THEMES;FB.PAGES=PAGES;FB.contrast=contrast;
FB.applyPrefs=()=>{try{const d=document.documentElement,P=S.prefs,st=d.style;const app=S.authed&&!['login','signup','forgot','reset','invite','expired','noorg','twofa','pverify'].includes(S.route.page);const vars=['--side','--primary','--primary-btn','--primary-hover','--primary-text','--orange','--bg','--surface'];
 if(!app){vars.forEach(v=>st.removeProperty(v));['data-density','data-bold','data-contrast','data-motion','data-focus'].forEach(a=>d.removeAttribute(a));document.querySelectorAll('[data-fb-shell]').forEach(e=>e.style.zoom='');return}
 const plat=FB.isPlatform();const useOrg=!S.orgPersonalise&&!plat;const th=THEMES[useOrg?S.orgDefaultTheme:P.theme]||THEMES.forest;let side=th[1],acc=th[2],dot=th[3];
 if(P.custom&&!useOrg&&!plat&&FB.rel('v11')){side=P.custom.side||side;acc=P.custom.accent||acc;dot=P.custom.dot||dot}
 let pk=P.page;if(pk==='device')pk=(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)?P.darkPage:P.lightPage;const pg=PAGES[pk]||PAGES.white;S.theme=pg[3]===1?'dark':'light';d.setAttribute('data-theme',S.theme);
 if(contrast(acc,'#ffffff')<4.5)acc=darken(acc,.75);if(contrast(acc,'#ffffff')<4.5)acc=darken(acc,.7);
 if(!plat){st.setProperty('--side',side);st.setProperty('--primary-btn',acc);st.setProperty('--primary-hover',darken(acc,.85));if(S.theme==='light'){st.setProperty('--primary',acc);st.setProperty('--primary-text',acc)}else{st.removeProperty('--primary');st.removeProperty('--primary-text')}st.setProperty('--orange',dot)}
 if(P.custom&&P.custom.page&&!useOrg&&FB.rel('v11')&&S.theme==='light')st.setProperty('--bg',P.custom.page);else if(pk!=='white')st.setProperty('--bg',pg[2]);else st.removeProperty('--bg');
 if(pg[3]===1)st.setProperty('--surface',pg[1]);else st.removeProperty('--surface');
 d.setAttribute('data-density',P.density);d.setAttribute('data-bold',P.bold?'1':'0');d.setAttribute('data-contrast',P.contrast?'1':'0');d.setAttribute('data-motion',P.motion?'1':'0');d.setAttribute('data-focus',P.focus?'1':'0');
 const z={default:1,large:1.1,larger:1.2,largest:1.32}[P.text]||1;document.querySelectorAll('[data-fb-shell]').forEach(e=>e.style.zoom=z===1?'':String(z));}catch(e){console.error(e)}};
subs.add(()=>requestAnimationFrame(FB.applyPrefs));setTimeout(()=>FB.applyPrefs(),300);
window.FB=FB;
})();
