// Time is an external test boundary; production code does not read this variable.
Date.now=()=>Number(process.env.FACTORY_TEST_NOW);
