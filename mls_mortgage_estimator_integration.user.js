// ==UserScript==
// @name         HARMLS Mortgage Estimator Integration
// @namespace    https://www.ericseastrand.com/
// @version      0.1
// @description  Pre populates fields in the mortgage estimator using data from a MLS listing
// @author       Eric Seastrand
// @include      https://www.mortgagecalculator.org/
// @include      https://matrix.harmls.com/Matrix/Public/Portal.aspx*
// @downloadURL  https://raw.githubusercontent.com/willcodeforfood/userscripts/master/mls_mortgage_estimator_integration.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_listValues
// ==/UserScript==

var fieldConstants = {
    pmi : '0.55',
    hoi : '2000',
    downpayment_type: 'percent',
    downpayment: 18,
    interest_rate: 5.1,
    term: 15 // mortgage length in years
};
var onCalculatedEventName = 'mortgage_calculated';
var storagePrefix = 'home_listing_';

function extractByKey(data, key, val) {
    var found = data.find(function(obj) {
      return obj[key] == val;
    });

    return found;
}

function sanitizeFloat(floatString) {
    var string = floatString.replace(/[^\d\.]/g, '')
    return parseFloat(string);
}

function extractRawListingData() {
    var data = $('.J_sect .row').map(function(e){
        var key = $(this).children().first().text().trim();
        var val = $(this).children().last().text().trim();

        return {key: key, val: val, el: this};
    });
    data = $.makeArray(data);
    console.log("Raw Data Extracted", data);

    data.extractByKey = function(val){
        try {
            return extractByKey(this, 'key', val).val;
        } catch(e) {console.log("Exception extracting data from page", val, e);}
        return false;
    };
    data.extractAsAmount = function(val) {
        try {
            return sanitizeFloat(data.extractByKey(val));
        } catch(e) {console.log("Exception extracting amount value from page", val, e);}
        return false;
    };
    data.findMatches = function(searchFunction) {
        return data.filter(function(obj) {
            return searchFunction(obj.key, obj.val);
        });
    }



    return data;
}

function extractListingData() {
    var data = extractRawListingData();

    var taxRate = data.extractAsAmount('Tax Rate') || 3.2;
    var listPrice = data.extractAsAmount('List Price');
    var hoaAmount = data.extractAsAmount('Maint Fee Amt');

    var hoaSchedule = data.extractByKey('Maint Fee Pay Schedule');
    var hoaAnnual;
    if(hoaSchedule == 'Annually') {
        hoaAnnual = hoaAmount;
    }else if(hoaSchedule == 'Monthly') {
        hoaAnnual = hoaAmount * 12;
    }else {
        var err = "Unable to determine HOA dues schedule multiplier from '"+hoaSchedule+"'";
        console.log(err, hoaSchedule, data);
        //throw err;
        alert(err);
    }

    return {
        listPrice: listPrice,
        taxRate : taxRate,
        taxAnnual: taxRate * listPrice / 100,
        hoaAnnual: hoaAnnual,
        address: getListingAddress()
    };
}

function prepareDataForMortgageCalculator(listing) {
    var dataToSend = {
        hoa : listing.hoaAnnual / 12, // 'Monthly HOA'
        property_tax : listing.taxAnnual,
        homevalue: listing.listPrice
    };
    return dataToSend;

}

function getListingAddress() {
    return $('.d-mega .J_formula').first().text().trim();
}

function createListingKey(address) {
    address = address || getListingAddress();
    address = address.trim();
    if(!address) {
        throw "Can't deteremine address.";
    }
    return address.toLowerCase().replace(/[^\w]/g, '-');
}

function buildMortgageCalculatorLink() {
    var listing = extractListingData();
    var queryString = jQuery.param(prepareDataForMortgageCalculator(listing));


    var meta = {listKey: createListingKey(listing.address), address: listing.address, homevalue: listing.listPrice};
    GM_setValue('last_listing', meta);

    return 'https://www.mortgagecalculator.org/#' + queryString;
}

function openMortgageCalculator() {
    var url = buildMortgageCalculatorLink();
    window.open(url);
}
$(document).keydown(function(e){
    if(e.keyCode === 72 && e.altKey) {
        // Alt + H
        openMortgageCalculator();
    }

   if(e.keyCode === 66 && e.altKey) {
        // Alt + B
       //console.log(getCachedDataForAddress());
       var i = monthlyPaymentInjector();
       unsafeWindow.monthlyPaymentInjector = i;
       i.run();

       addSchoolLinks();
    }

});

unsafeWindow.getCachedDataForAddress = getCachedDataForAddress;
function getCachedDataForAddress(address) {
    var listKey = createListingKey(address);
    var listingData = GM_getValue(storagePrefix+listKey);

    return listingData;
}

if(window.location.href.indexOf('https://www.mortgagecalculator.org/#') !== -1) {
    $(setMortageCalculatorFieldsFromHash);
} else {
    sendPriceUpdateMessage();
}

/// Stuff for school name resolution
function getSchoolNames() {
    var data = extractRawListingData();
    var results = data.findMatches((k) => k.toLowerCase().indexOf('school') !== -1);

    var schools = results.map(function(data){
        var schoolName = data.val;
        var schoolType = data.key;

if(schoolType.toLowerCase().indexOf('district') !== -1) {
schoolName = schoolName.replace(/[^a-zA-Z\s]/g, '').trim();
schoolName += " ISD";
    schoolType = schoolName;
}

        return {name: schoolName, type: schoolType};
    });


    schools = schools.sort((a,b) => {
        function scoreItem(s) {
            if(/junior/i.test(s)) {
                return 5;
            }
            if(/high/i.test(s)) {
                return 7;
            }
            if(/middle/i.test(s)) {
                return 5;
            }
            if(/elem/i.test(s)) {
                return 3;
            }
            if(/(isd)|(district)/i.test(s)) {
                return 0;
            }
            return -1;
        }

        return Math.sign( scoreItem(a.name) - scoreItem(b.name) );
    });

    console.log(schools);

    return schools;
}

function addSchoolLinks() {
    var container = jQuery('a[title="View Map"]').closest('.d-paddingTop--20');

    var schoolNames = getSchoolNames();

    schoolNames.forEach(function(school){
        var link = $('<a>').attr('target', 'blank').css('padding', '0 1em');

        var linkText = normalizeSchoolName(school.type, school.name);

        link.attr('href', "https://schools.texastribune.org/search/?q="+encodeURIComponent(school.name));
        link.text(linkText);

        container.append(link);
    });
}

function normalizeSchoolName(type, name) {
    name = name.replace(/junior high( school)?/i, ' JHS');
    name = name.replace(/high( school)?/i, ' HS');
    name = name.replace(/middle( school)?/i, ' MS');
    name = name.replace(/(elementary|elem)( school)?/i, ' Elem');
    name = name.trim();
    return name;
}

function sortArrayByPreset(items, theOrder, itemKey) {
var itemsOrdered = items.sort(function(a,b) {
var _a = itemKey ? a[itemKey] : a;
var _b = itemKey?b[itemKey] : b;
return Math.sign(theOrder.indexOf(_a) - theOrder.indexOf(_b));
});

for (var i = 0; i < theOrder.length; i++) {
    if (items.indexOf(theOrder[i]) > -1) {
        itemsOrdered.push(theOrder[i]);
    }
}
return itemsOrdered;
}

/// END Stuff for school name resolution

function sendPriceUpdateMessage() {
    var monthlyPayment = $('.rw-box:contains("Payment With PMI"), .rw-box:contains("Monthly Payment")').find('.left-cell h3').first().text();
    monthlyPayment = sanitizeFloat(monthlyPayment);

    var loanAmount = sanitizeFloat($('input[name="param[principal]"]').val());
    var homeValue = sanitizeFloat($('input[name="param[homevalue]"]').val());
    var downPayment = homeValue - loanAmount;

    var message = {
        downPayment: downPayment,
        monthlyPayment: monthlyPayment,
        homeValue: homeValue
    };

    var listing = GM_getValue('last_listing'); //{address: listing.address, homevalue: listing.listPrice}

    GM_setValue(storagePrefix+listing.listKey, {...message, ...listing});
}

function setMortageCalculatorFieldsFromHash() {
    var queryString = window.location.hash.slice(1);
    var inputsToSet = new URLSearchParams( queryString );
    var fieldsToSet = {};
    for (let definition of inputsToSet) {
        var field = definition[0];
        var value = definition[1];
        fieldsToSet[field] = value;
    }

    let merged = {...fieldsToSet, ...fieldConstants  };
    Object.entries(merged).forEach(([field, value]) => {

        console.log("Setting field", field, value);

        var input = $('.calcu-block input').filter((i, e) => e.name=="param["+field+"]");

        if(input.find('[type="radio"]').length == input.length ) {
            console.log("Detected radio:", field);
            var radioToCheck = input.find((i, e) => e.value == value );
            console("Checking radio", radioToCheck);
            radioToCheck.prop("checked", true);
            return;
        }

        console.log("Setting field", input);

        input.val(value);
    });
    fixPrincipal();

    jQuery('.calcu-block [type="submit"][value="Calculate"]').click();
}

function fixPrincipal() {
var $principal = $('input[name="param[principal]"]'),
        $downpayment = $('input[name="param[downpayment]"]'),
        $homevalue = $('input[name="param[homevalue]"]');

    function changePrincipal() {
        var principal, homevalue, downpayment,
            $downpayment_type = $('input[name="param[downpayment_type]"]:checked');

        homevalue = parseFloat($homevalue.val());
        downpayment = parseFloat($downpayment.val());
        if (isNaN(homevalue)) {
            homevalue = 0;
        }
        if (isNaN(downpayment)) {
            downpayment = 0;
        }
        if ($downpayment_type.val() == 'money') {
            principal = homevalue - downpayment;
        }
        else {
            if (downpayment != 0) {
                principal = homevalue * (1 - downpayment/100);
            }
        }

        $principal.val(principal.toFixed(2));
    }
    changePrincipal();
}
function monthlyPaymentInjector() {
    var self = {};
    self.run = function() {
        if(getListingAddress()) {
            self.addPaymentInfoToListingDetail();
        }

        self.addPaymentInfoToList();
    }

    self.addPaymentInfoToList = function() {
        var addresses = $('#_ctl0_m_pnlRenderedDisplay a[href^="javascript:__doPostBack"]');

        addresses.each((i, el) => self.addPaymentInfoToListElement(el, $(el).text().trim()));
    }

    self.addPaymentInfoToListElement = function(element, address) {
        console.log(element, address);

        var message = self.getMonthlyPaymentMessage(address);

        var existingMonthlyPrice = $(element).closest('.multiLineDisplay').find('.monthly-price');
        if(existingMonthlyPrice.length < 1) {
            var priceElement = $(element).closest('.multiLineDisplay').find('span.d-fontSize--largest').addClass('total-price');
            var template = priceElement.clone();
            template.addClass('monthly-price').css('color', '#c74117');
            existingMonthlyPrice = template;
            template.insertAfter(priceElement);
        }

        existingMonthlyPrice.text(message);


    }

    self.addPaymentInfoToListingDetail = function() {
        var addressField = $('.d-mega .J_formula:first');
        addressField.addClass('totalPrice');

        var template = addressField.closest('#wrapperTable').clone();
        template.addClass('monthly-price').css('color', '#c74117');

        var message = self.getMonthlyPaymentMessage();
        var container = jQuery('a[title="View Map"]').closest('.d-paddingTop--20');
        container.append( $("<span>").text(message) );
return;
        template.find('.J_formula').text(message);

        addressField.closest('.d-mega').first().append(template);
    }

    self.getMonthlyPaymentMessage = function(address) {
        var payment = self.getPaymentForAddress(address);
        if(payment) {
            var message = '$' + payment.toLocaleString() + "/mo";
        } else {
            message = "No Monthly Price Data";
        }
        return message;
    }

    self.getPaymentForAddress = function(address) {
        var data = getCachedDataForAddress(address);

        if(!data) {
            return false;
        }
        return data.monthlyPayment;
    }

    return self;
}







unsafeWindow.findSortedDates = function() {
    var regex = new RegExp(/^\d{4}$/); // expression here

    var dates = $.makeArray($(".d-textStrong").filter(function () {
        return regex.test($(this).text().trim()); 
    }).map((i,e)=>e.textContent.trim()));
    
    return dates.sort();
}



unsafeWindow.GM_getValue = GM_getValue;
unsafeWindow.GM_setValue = GM_setValue;
unsafeWindow.GM_listValues = GM_listValues;



