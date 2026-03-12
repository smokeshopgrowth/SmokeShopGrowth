const fs = require('fs');

let content = fs.readFileSync('template.html', 'utf8');

// Replace business names
content = content.replace(/Flava(?=\s|<\/span>|<\/div>)/gi, '{{BUSINESS_NAME}}');
content = content.replace(/Flava Depot/gi, '{{BUSINESS_NAME}}');
content = content.replace(/FLAVA_DEPOT/gi, '{{INSTAGRAM}}');
content = content.replace(/flava_depot/gi, '{{INSTAGRAM}}');

// Replace Address & Phone
content = content.replace('Your Address Here<br>Houston, TX', '{{ADDRESS}}<br>{{CITY}}, {{STATE}}');
content = content.replace('(555) 000-0000', '{{PHONE}}');

// Replace hours
content = content.replace('Mon – Sat &nbsp; 10:00 AM – 8:00 PM &nbsp;&nbsp;|&nbsp;&nbsp; Sunday &nbsp; 10:00 AM – 5:00 PM', '{{HOURS}}');

// Handle some leftover FD
content = content.replace(/content:'FD'/g, "content:'{{BUSINESS_NAME}}'");

// Replace some inner text where Flava or Depot are split by spans
content = content.replace(/<span class="ht-f">Flava<\/span>\s*<span class="ht-d">Depot<\/span>/g, '<span class="ht-f">{{BUSINESS_NAME}}</span>');
content = content.replace(/<span class="fp">Flava<\/span>\s*<span class="fg">Depot<\/span>/g, '<span class="fp">{{BUSINESS_NAME}}</span>');
content = content.replace(/<div class="ag-flava">Flava<\/div>\s*<div class="ag-depot">Depot<\/div>/g, '<div class="ag-flava">{{BUSINESS_NAME}}</div>');
content = content.replace(/<span class="nf">Flava<\/span>\s*<span class="nd">Depot<\/span>/g, '<span class="nf">{{BUSINESS_NAME}}</span>');


fs.writeFileSync('template.html', content, 'utf8');
console.log('Template parsed and variables injected.');
