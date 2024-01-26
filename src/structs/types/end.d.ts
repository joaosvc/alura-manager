declare namespace NodeJS {
    interface ProcessEnv {
        DBX_CLIENT_KEY: string;
        DBX_CLIENT_SECRET: string;
        DBX_REFRESH_TOKEN: string;
    }
}