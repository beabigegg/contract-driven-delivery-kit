<template>
  <div class="sample">
    <h1>{{ title }}</h1>
    <p>{{ message }}</p>
    <button @click="handleClick">Click me</button>
  </div>
</template>
<!-- script setup starts at line 9, content from line 10 -->
<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';

const title = ref('Sample Component');
const message = ref('Hello World');

function handleClick() {
  title.value = 'Clicked!';
}

const computedTitle = computed(() => title.value.toUpperCase());
</script>

<style scoped>
.sample {
  padding: 1rem;
  color: #333;
}

h1 {
  font-size: 2rem;
}

p {
  margin: 0.5rem 0;
}

button {
  padding: 0.5rem 1rem;
}
</style>
