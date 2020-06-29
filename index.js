const axios = require("axios");
const cheerio = require('cheerio');
const ExcelJS = require('exceljs');
const fs = require('fs');

const MAX_PAGE = 1598;

const REGEX = /\d+/g;
const MIN_COST = 1000000000;
const MAX_RETRY = 10;
const params = {
    bid_target: "bid-result",
    aujusted_limited: 0,
    bid_type: 1,
    date_type: "BID_OPEN_DT",
    datetimestart: "01/01/2016",
    datetimesend: "22/06/2020",
    bid_method: 01,
    // page: 1
};
const baseUrl = "http://muasamcong.mpi.gov.vn";
const urlMain = "/goi-thau";

const requestPage = (url, params) => {
    return axios({
        method: "GET",
        timeout: 1000,
        crossDomain: true,
        headers: {
            "upgrade-insecure-requests": "1",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            "cache-control": "no-cache"
        },
        url,
        params,
    }).then(function(response) {
        return response.data;
    });
}

const normalizeCost = (cost) => {
    return parseInt(cost.match(REGEX).join(""), 10);
}

const getInfo = (htmlContent, url) => {
    let dataNeedGet = null;

    const $ = cheerio.load(htmlContent);
    $("table").each((index, table) => {
        if (index === 1) {
            const cost_pid = normalizeCost($(table).find("tr:nth-child(4) > td:nth-child(2)").text());
            if (cost_pid >= MIN_COST) {
                dataNeedGet = {
                    cost_pid,
                    name_pid: $(table).find("tr:nth-child(3) > td:nth-child(2)").text(),
                    investor: $(table).find("tr:nth-child(1) > td:nth-child(4)").text(),
                    contractor_name: $(table).find("tr:nth-child(6) > td:nth-child(2)").text(),
                    tax_code: $(table).find("tr:nth-child(6) > td:nth-child(4)").text(),
                    cost_successful_pid: normalizeCost($(table).find("tr:nth-child(9) > td:nth-child(4)").text()),
                    url,
                }
            }
        }
    });

    return dataNeedGet;
}

const getPidInfo = (htmlContent) => {
    const $ = cheerio.load(htmlContent);

    let url = "";
    $("iframe").each((index, element) => {
        const srcPage = $(element).attr("src");
        if (srcPage && srcPage.includes(".jsp")) {
            url = srcPage;
        }
    });

    return requestPage(`${baseUrl}${url}`, {});
}

const reTryGetFunc = async (func, count, index) => {
    let result;
    try {
        result = await func();
    } catch (e) {
        console.log(`Index: ${index} - Retry ${count + 1}`);
        if (count <= MAX_RETRY) {
            await sleep(5000);
            result = await reTryGetFunc(func, count++, index);
        } else {
            throw e;
        }
    }

    return result;
}

const getPageChild = (htmlContent) => {
    const $ = cheerio.load(htmlContent);
    const $tablePidBody = $(".table-dau-thau");

    const urls = [];
    $tablePidBody.find("tr > td > a").each((index, element) => {
        const href = $(element).attr("href");
        urls.push(`${baseUrl}${href}`);
    });

    return Promise.all(urls.map(async (url, index) => {
        let data = [];

        try {
            const func = async () => {
                return await requestPage(url, {}).then(dataPage => getPidInfo(dataPage));
            }
            const dataPid = await reTryGetFunc(func, 0, index);
            data = getInfo(dataPid, url);
        } catch (e) {
            console.log(`error ${index}`);
        }

        return data;
    }));
}

const startGetDataPage = (page) => {
    return requestPage(`${baseUrl}${urlMain}`, { ...params, page })
        .then(htmlContent => {
            return getPageChild(htmlContent);
        }).then(dataPids => dataPids.filter(dataPid => dataPid));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const init = async () => {
    let finalData = [];
    const pageError = [376, 438, 439, 440, 441, 558, 559, 562, 685, 691, 811, 1123];
    // for (let index = 1; index <= MAX_PAGE; index++) {
    //     let dataOfPage = [];
    //     try {
    //         console.log(`Start get data page: ${index}`);
    //         console.time(`GET_DATA_${index}`);
    //         const func = async () => {
    //             console.log("GET_DATA_PAGE: ", index);
    //             return await startGetDataPage(index);
    //         }
    //         dataOfPage = await reTryGetFunc(func, 0, index);

    //         console.timeEnd(`GET_DATA_${index}`);
    //         console.log(`Get succes data page: ${index} - length data: ${dataOfPage.length}`);
    //     } catch (e) {
    //         console.log(`Get page error${index}`);
    //         pageError.push(index);
    //     }

    //     finalData = [...finalData, ...dataOfPage];
    //     if (index % 100 === 0 || index === MAX_PAGE) {
    //         exportToExcel(finalData, index);
    //         finalData = [];
    //     }
    //     await sleep(1000);
    // }

    console.log("All page error is:", pageError.length);
    if (pageError.length > 0) {
        for (let index = 0; index < pageError.length; index++) {
            const pageIndex = pageError[index];
            let dataOfPage = [];
            try {
                console.log(`Start get data page again: ${pageIndex}`);
                const func = async () => {
                    return await startGetDataPage(pageIndex);
                }
                dataOfPage = await reTryGetFunc(func, 0, pageIndex);
                console.log(`Get succes data page: ${pageIndex} - length data: ${dataOfPage.length}`);
            } catch (e) {
                console.log(`Get page error${pageIndex}`);
            }
    
            finalData = [...finalData, ...dataOfPage];
        }
        exportToExcel(finalData, "error_page");
    }
}

const exportToExcel = async (datas, index) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Gói thầu');

    sheet.columns = [
        { key: 'index', header: 'STT' },
        { key: 'name_pid', header: 'Tên gói thầu' },
        { key: 'investor', header: 'Chủ đầu tư' },
        { key: 'contractor_name', header: 'Tên nhà thầu' },
        { key: 'tax_code', header: 'Mã số thuế' },
        { key: 'cost_pid', header: 'Giá gói thầu' },
        { key: 'cost_successful_pid', header: 'Giá trúng thầu' },
        { key: 'url', header: 'URL' },
    ];

    datas.map((data, index) => {
        sheet.addRow({ ...data, index });
    });

    await workbook.xlsx.writeFile(`export_${index}.xlsx`);
}

const exportToCsv = (datas) => {
    const createCsvWriter = require('csv-writer').createObjectCsvWriter;
    const csvWriter = createCsvWriter({
        path: 'out.csv',
        header: [
            { id: 'index', title: 'STT' },
            { id: 'name_pid', title: 'Tên gói thầu' },
            { id: 'investor', title: 'Chủ đầu tư' },
            { id: 'contractor_name', title: 'Tên nhà thầu' },
            { id: 'tax_code', title: 'Mã số thuế' },
            { id: 'cost_pid', title: 'Giá gói thầu' },
            { id: 'cost_successful_pid', title: 'Giá trúng thầu' },
        ]
    });

    const datasCsv = datas.map((data, index) => ({ ...data, index }));
    csvWriter
        .writeRecords(datasCsv)
        .then(() => console.log('The CSV file was written successfully'));
}

init();