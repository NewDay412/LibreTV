const searchCache = new Map();

async function searchByAPIAndKeyWord(apiId, query) {
  try {
    const cacheKey = `${apiId}_${query}`;
    if (searchCache.has(cacheKey)) {
      const cached = searchCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 300000) { // 5分钟缓存有效期
        return cached.data;
      }
      searchCache.delete(cacheKey);
    }
    let apiUrl, apiName, apiBaseUrl;

    // 处理自定义API
    if (apiId.startsWith('custom_')) {
      const customIndex = apiId.replace('custom_', '');
      const customApi = getCustomApiInfo(customIndex);
      if (!customApi) return [];

      apiBaseUrl = customApi.url;
      apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
      apiName = customApi.name;
    } else {
      // 内置API
      if (!API_SITES[apiId]) return [];
      apiBaseUrl = API_SITES[apiId].api;
      apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
      apiName = API_SITES[apiId].name;
    }

    // 添加超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(PROXY_URL + encodeURIComponent(apiUrl), {
      headers: API_CONFIG.search.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
      return [];
    }

    // 处理第一页结果
    const results = data.list.map((item) => ({
      ...item,
      source_name: apiName,
      source_code: apiId,
      api_url: apiId.startsWith('custom_')
        ? getCustomApiInfo(apiId.replace('custom_', ''))?.url
        : undefined,
    }));

    // 获取总页数
    const pageCount = data.pagecount || 1;
    // 确定需要获取的额外页数 (最多获取maxPages页)
    const pagesToFetch = Math.min(pageCount - 1, 1); // 最多额外请求1页结果

    // 如果有额外页数，获取更多页的结果
    if (pagesToFetch > 0) {
      const additionalPagePromises = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        // 构建分页URL
        const pageUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page);

        // 创建获取额外页的Promise
        const pagePromise = (async () => {
          try {
            const pageController = new AbortController();
            const pageTimeoutId = setTimeout(() => pageController.abort(), 3000);

            const pageResponse = await fetch(PROXY_URL + encodeURIComponent(pageUrl), {
              headers: API_CONFIG.search.headers,
              signal: pageController.signal,
            });

            clearTimeout(pageTimeoutId);

            if (!pageResponse.ok) return [];

            const pageData = await pageResponse.json();

            if (!pageData || !pageData.list || !Array.isArray(pageData.list)) return [];

            // 处理当前页结果
            return pageData.list.map((item) => ({
              ...item,
              source_name: apiName,
              source_code: apiId,
              api_url: apiId.startsWith('custom_')
                ? getCustomApiInfo(apiId.replace('custom_', ''))?.url
                : undefined,
            }));
          } catch (error) {
            console.warn(`API ${apiId} 第${page}页搜索失败:`, error);
            return [];
          }
        })();

        additionalPagePromises.push(pagePromise);
      }

      // 等待所有额外页的结果
      const additionalResults = await Promise.all(additionalPagePromises);

      // 合并所有页的结果
      additionalResults.forEach((pageResults) => {
        if (pageResults.length > 0) {
          results.push(...pageResults);
        }
      });
    }

    searchCache.set(cacheKey, {
      data: results,
      timestamp: Date.now()
    });
    return results;
  } catch (error) {
    console.warn(`API ${apiId} 搜索失败:`, error);
    return [];
  }
}
