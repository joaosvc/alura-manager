declare namespace NodeJS {
    interface ProcessEnv {
        DBX_FROM_CLIENT_KEY: string;
        DBX_FROM_CLIENT_SECRET: string;
        DBX_FROM_REFRESH_TOKEN: string;
        DBX_TO_CLIENT_KEY: string;
        DBX_TO_CLIENT_SECRET: string;
        DBX_TO_REFRESH_TOKEN: string;
    }
}
