import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';

// Define API URLs
let API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://produccion.facturamovil.cl';
let API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN || '9fc6eb45-f925-4303-8538-a27ec7c862ba';
let COMPANY_ID = process.env.EXPO_PUBLIC_COMPANY_ID || '29';

// Auth state
let AUTH_INITIALIZED = false;
let USER_TOKEN: string | null = null;
let USER_COMPANY_ID: string | null = null;

// Storage keys
const AUTH_USER_KEY = '@auth_user';
const ACTIVE_COMPANY_KEY = '@active_company';
const PRODUCTS_CACHE_KEY = '@products_cache';
const CLIENTS_CACHE_KEY = '@clients_cache';
const SALES_CACHE_KEY = '@sales_cache';
const INVOICE_DETAILS_CACHE_KEY = '@invoice_details';

// Axios instance - Increased timeout from 15000 to 30000ms
const axiosInstance: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // Increased timeout to 30 seconds to allow more time for server response
});

// Request interceptor
axiosInstance.interceptors.request.use(
  async (config) => {
    if (!AUTH_INITIALIZED) {
      await initializeAuthHeader();
    }
    const token = USER_TOKEN || API_TOKEN;
    const url = config.url || '';
    console.log(`=== API DEBUG: Request headers for ${url} ===`, {
      ...config.headers,
      'FACMOV_T': token.substring(0, 10) + '...'
    });
    config.headers['FACMOV_T'] = token;
    return config;
  },
  (error) => Promise.reject(error)
);

// Initialize auth data
const initializeAuthHeader = async () => {
  try {
    console.log('=== API DEBUG: Initializing auth from storage ===');
    if (typeof window === 'undefined') {
      console.log('=== API DEBUG: Skipping in server environment ===');
      return;
    }
    const userJson = await AsyncStorage.getItem(AUTH_USER_KEY);
    if (userJson) {
      const userData = JSON.parse(userJson);
      if (userData.token) {
        USER_TOKEN = userData.token;
        console.log('=== API DEBUG: Loaded user token ===', USER_TOKEN.substring(0, 10) + '...');
      }
      const activeCompanyJson = await AsyncStorage.getItem(ACTIVE_COMPANY_KEY);
      if (activeCompanyJson) {
        const activeCompany = JSON.parse(activeCompanyJson);
        if (activeCompany && activeCompany.id) {
          USER_COMPANY_ID = activeCompany.id.toString();
        }
      } else if (userData.mobileCompany && userData.mobileCompany.id) {
        USER_COMPANY_ID = userData.mobileCompany.id.toString();
      } else if (userData.companies && userData.companies.length > 0) {
        USER_COMPANY_ID = userData.companies[0].id.toString();
      }
      console.log('=== API DEBUG: Loaded company ID ===', USER_COMPANY_ID);
    }
    AUTH_INITIALIZED = true;
  } catch (error) {
    console.error('=== API DEBUG: Error initializing auth ===', error);
  }
};

// Update auth data
const updateAuthData = (token: string, companyId: number | string) => {
  USER_TOKEN = token;
  USER_COMPANY_ID = companyId.toString();
  AUTH_INITIALIZED = true;
  console.log('=== API DEBUG: Auth data updated ===', { token: USER_TOKEN.substring(0, 10) + '...', companyId: USER_COMPANY_ID });
};

// Clear auth data
const clearAuthData = () => {
  USER_TOKEN = null;
  USER_COMPANY_ID = null;
  AUTH_INITIALIZED = false;
  console.log('=== API DEBUG: Auth data cleared ===');
};

// Interfaces
interface Municipality {
  code: string;
  name: string;
  regionalEntity?: {
    code: string;
    name: string;
  };
}

interface Activity {
  id: number;
  code: string;
  name: string;
}

export interface Client {
  id: number;
  code: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  municipality?: Municipality;
  activity?: Activity;
  line?: string;
}

interface Unit {
  id?: number;
  code: string;
  name: string;
}

interface Category {
  id: number;
  code: string;
  name: string;
  otherTax?: {
    id: number;
    code: string;
    name: string;
    percent: number;
  };
}

export interface Product {
  id: number;
  code: string;
  name: string;
  description?: string;
  price: number;
  unit: Unit;
  category: Category;
}

interface ProductDetail {
  position: number;
  product: {
    code: string;
    name: string;
    price: number;
    unit?: { code: string };
    category?: {
      id: number;
      code: string;
      name: string;
      otherTax?: {
        id: number;
        code: string;
        name: string;
        percent: number;
      };
    };
  };
  quantity: number;
  description?: string;
}

export interface InvoiceRequest {
  currency: string;
  hasTaxes: boolean;
  client: {
    code: string;
    name: string;
    address?: string;
    municipality?: string;
    line?: string;
  };
  date: string;
  details: ProductDetail[];
  paymentMethod?: string;
  paymentCondition?: string;
}

export interface TicketRequest {
  netAmounts: boolean;
  hasTaxes: boolean;
  ticketType: {
    code: string;
  };
  client?: {
    code: string;
    name: string;
    address?: string;
    municipality?: string;
  };
  date: string;
  details: ProductDetail[];
  paymentMethod?: string;
  paymentCondition?: string;
}

export interface Document {
  id: number;
  type: string;
  assignedFolio: string;
  externalFolio: string | null;
  date: string;
  state: string[];
  client: {
    id: number;
    rut: string;
    name: string;
    email?: string;
  };
  total: number;
  validation: string;
  details?: ProductDetail[];
}

// API methods

const getProducts = async (forceRefresh = false, searchTerm = ''): Promise<Product[]> => {
  try {
    console.log('=== API DEBUG: getProducts ===', { forceRefresh, searchTerm });
    if (!AUTH_INITIALIZED) await initializeAuthHeader();
    const companyId = USER_COMPANY_ID || COMPANY_ID;
    
    // First check cache if not forcing refresh and no search term
    if (!forceRefresh && !searchTerm) {
      const cached = await AsyncStorage.getItem(PRODUCTS_CACHE_KEY);
      if (cached) {
        console.log('=== API DEBUG: Using cached products ===');
        return JSON.parse(cached);
      }
    }
    
    // Make API request
    const endpoint = searchTerm ? `/services/common/product/${searchTerm}` : '/services/common/product';
    const response = await axiosInstance.get(endpoint);
    
    // Validate response data
    if (!response.data) {
      throw new Error('Invalid response format: No data received');
    }
    
    let products: Product[] = response.data?.products || response.data || [];
    
    // Only cache if this is a full product list (not a search)
    if (!searchTerm && Array.isArray(products)) {
      await AsyncStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products));
    }
    
    console.log('=== API DEBUG: Retrieved products ===', products.length);
    return products;
  } catch (error) {
    console.error('=== API DEBUG: Error fetching products ===', error);
    
    // Check if there's cached data we can fall back to
    const cached = await AsyncStorage.getItem(PRODUCTS_CACHE_KEY);
    if (cached) {
      console.log('=== API DEBUG: Falling back to cached products ===');
      return JSON.parse(cached);
    }
    
    // If no cached data, throw the error
    throw error;
  }
};

const searchProducts = async (query: string): Promise<Product[]> => {
  return getProducts(true, query);
};

const getClients = async (forceRefresh = false, searchTerm = ''): Promise<Client[]> => {
  try {
    console.log('=== API DEBUG: getClients ===', { forceRefresh, searchTerm });
    if (!AUTH_INITIALIZED) await initializeAuthHeader();
    const companyId = USER_COMPANY_ID || COMPANY_ID;
    
    // Check cache first if applicable
    if (!forceRefresh && !searchTerm) {
      const cached = await AsyncStorage.getItem(CLIENTS_CACHE_KEY);
      if (cached) {
        console.log('=== API DEBUG: Using cached clients ===');
        return JSON.parse(cached);
      }
    }
    
    const endpoint = searchTerm ? `/services/common/client/${searchTerm}` : '/services/common/client';
    const response = await axiosInstance.get(endpoint);
    
    // Validate response
    if (!response.data) {
      throw new Error('Invalid response format: No data received for clients');
    }
    
    let clients: Client[] = response.data?.clients || response.data || [];
    
    // Cache full client list, not search results
    if (!searchTerm && Array.isArray(clients)) {
      await AsyncStorage.setItem(CLIENTS_CACHE_KEY, JSON.stringify(clients));
    }
    
    console.log('=== API DEBUG: Retrieved clients ===', clients.length);
    return clients;
  } catch (error) {
    console.error('=== API DEBUG: Error fetching clients ===', error);
    
    // Try to use cached data
    const cached = await AsyncStorage.getItem(CLIENTS_CACHE_KEY);
    if (cached) {
      console.log('=== API DEBUG: Falling back to cached clients ===');
      return JSON.parse(cached);
    }
    
    throw error;
  }
};

const getSales = async (forceRefresh = false): Promise<Document[]> => {
  try {
    console.log('=== API DEBUG: getSales ===', { forceRefresh });
    if (!AUTH_INITIALIZED) await initializeAuthHeader();
    const companyId = USER_COMPANY_ID || COMPANY_ID;
    
    // Try to use cache if not forcing refresh
    if (!forceRefresh) {
      const cached = await AsyncStorage.getItem(SALES_CACHE_KEY);
      if (cached) {
        console.log('=== API DEBUG: Using cached sales ===');
        return JSON.parse(cached);
      }
    }
    
    const endpoint = `/services/common/company/${companyId}/lastsales/`;
    const response = await axiosInstance.get(endpoint);
    
    // Validate response data
    if (!response.data) {
      throw new Error('Invalid response format: No data received for sales');
    }
    
    let sales: Document[] = response.data?.documents || response.data || [];
    
    // Ensure sales is an array before caching
    if (Array.isArray(sales)) {
      await AsyncStorage.setItem(SALES_CACHE_KEY, JSON.stringify(sales));
      console.log('=== API DEBUG: Retrieved sales ===', sales.length);
    } else {
      console.error('=== API DEBUG: Invalid sales data format ===', typeof sales);
      sales = [];
    }
    
    return sales;
  } catch (error) {
    console.error('=== API DEBUG: Error fetching sales ===', error);
    
    // Try to use cached data
    const cached = await AsyncStorage.getItem(SALES_CACHE_KEY);
    if (cached) {
      console.log('=== API DEBUG: Falling back to cached sales ===');
      return JSON.parse(cached);
    }
    
    throw error;
  }
};

const getInvoiceDetail = async (assignedFolio: string): Promise<Document> => {
  try {
    console.log(`=== API DEBUG: getInvoiceDetail for folio ${assignedFolio} ===`);
    if (!AUTH_INITIALIZED) await initializeAuthHeader();
    const companyId = USER_COMPANY_ID || COMPANY_ID;
    const cacheKey = `${INVOICE_DETAILS_CACHE_KEY}_${assignedFolio}`;
    
    // Try to use cached invoice details
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      console.log('=== API DEBUG: Using cached invoice detail ===');
      return JSON.parse(cached);
    }
    
    const endpoint = `/services/common/company/${companyId}/invoice/${assignedFolio}/getInfo`;
    const response = await axiosInstance.get(endpoint);
    
    // Validate response
    if (!response.data) {
      throw new Error('Invalid invoice detail response: No data received');
    }
    
    // Cache the invoice details
    await AsyncStorage.setItem(cacheKey, JSON.stringify(response.data));
    console.log('=== API DEBUG: Retrieved invoice detail ===');
    return response.data;
  } catch (error: any) {
    console.error('=== API DEBUG: Error fetching invoice detail ===', error);
    if (error.response?.status === 404) {
      throw new Error(`Factura con folio ${assignedFolio} no encontrada`);
    }
    throw error;
  }
};

const getInvoiceDetailById = async (invoiceId: number): Promise<Document> => {
  try {
    console.log(`=== API DEBUG: getInvoiceDetailById for id ${invoiceId} ===`);
    
    // Try to get from cache first
    const cacheKey = `${INVOICE_DETAILS_CACHE_KEY}_id_${invoiceId}`;
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      console.log('=== API DEBUG: Using cached invoice detail by id ===');
      return JSON.parse(cached);
    }
    
    // If not in cache, get from sales list
    const sales = await getSales();
    const invoice = sales.find(doc => doc.id === invoiceId);
    if (!invoice) {
      throw new Error(`Invoice with id ${invoiceId} not found in sales list`);
    }
    
    // Get detailed information
    const details = await getInvoiceDetail(invoice.assignedFolio);
    
    // Cache the result by ID as well
    await AsyncStorage.setItem(cacheKey, JSON.stringify(details));
    
    return details;
  } catch (error) {
    console.error('=== API DEBUG: Error fetching invoice detail by id ===', error);
    throw error;
  }
};

const getInvoicePdf = async (id: number, validation: string): Promise<string> => {
  try {
    console.log(`=== API DEBUG: getInvoicePdf for id ${id} ===`);
    const pdfUrl = `${API_BASE}/document/toPdf/${id}?v=${validation}`;
    console.log('=== API DEBUG: Generated PDF URL ===', pdfUrl);
    return pdfUrl;
  } catch (error) {
    console.error('=== API DEBUG: Error generating PDF URL ===', error);
    throw error;
  }
};

const createInvoice = async (invoiceData: InvoiceRequest): Promise<any> => {
  try {
    console.log('=== API DEBUG: createInvoice ===');
    if (!AUTH_INITIALIZED) await initializeAuthHeader();
    const companyId = USER_COMPANY_ID || COMPANY_ID;
    const endpoint = `/services/raw/company/${companyId}/invoice`;
    const response = await axiosInstance.post(endpoint, invoiceData);
    await AsyncStorage.removeItem(SALES_CACHE_KEY);
    console.log('=== API DEBUG: Invoice created ===');
    return response.data;
  } catch (error) {
    console.error('=== API DEBUG: Error creating invoice ===', error);
    throw error;
  }
};

const createTicket = async (ticketData: TicketRequest): Promise<any> => {
  try {
    console.log('=== API DEBUG: createTicket ===');
    if (!AUTH_INITIALIZED) await initializeAuthHeader();
    const companyId = USER_COMPANY_ID || COMPANY_ID;
    const endpoint = `/services/raw/company/${companyId}/ticket`;
    const response = await axiosInstance.post(endpoint, ticketData);
    await AsyncStorage.removeItem(SALES_CACHE_KEY);
    console.log('=== API DEBUG: Ticket created ===');
    return response.data;
  } catch (error) {
    console.error('=== API DEBUG: Error creating ticket ===', error);
    throw error;
  }
};

const clearProductsCache = async () => {
  await AsyncStorage.removeItem(PRODUCTS_CACHE_KEY);
  console.log('=== API DEBUG: Products cache cleared ===');
};

const clearClientsCache = async () => {
  await AsyncStorage.removeItem(CLIENTS_CACHE_KEY);
  console.log('=== API DEBUG: Clients cache cleared ===');
};

const clearSalesCache = async () => {
  await AsyncStorage.removeItem(SALES_CACHE_KEY);
  console.log('=== API DEBUG: Sales cache cleared ===');
};

export const api = {
  axiosInstance,
  getProducts,
  searchProducts,
  getClients,
  getSales,
  getInvoiceDetail,
  getInvoiceDetailById,
  getInvoicePdf,
  clearProductsCache,
  clearClientsCache,
  clearSalesCache,
  createInvoice,
  createTicket,
  updateAuthData,
  clearAuthData,
  initializeAuthHeader
};